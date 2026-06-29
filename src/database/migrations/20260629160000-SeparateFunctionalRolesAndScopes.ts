import type { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_ADMIN_ROLES = [
  'ADMIN_PROVINCE',
  'ADMIN_DISTRICT',
  'ADMIN_SUBDISTRICT',
  'ADMIN_SCHOOL',
] as const;

export class SeparateFunctionalRolesAndScopes20260629160000 implements MigrationInterface {
  name = 'SeparateFunctionalRolesAndScopes20260629160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE roles
        ADD COLUMN IF NOT EXISTS scope_policy TEXT NOT NULL DEFAULT 'ASSIGNABLE',
        ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_scope_policy'
        ) THEN
          ALTER TABLE roles
            ADD CONSTRAINT chk_roles_scope_policy
            CHECK (scope_policy IN ('ASSIGNABLE', 'OWN_ONLY'));
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_definition_migration_backup (
        name TEXT PRIMARY KEY,
        old_rank INTEGER NOT NULL,
        old_scope_mode TEXT NOT NULL,
        old_is_system BOOLEAN NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO role_definition_migration_backup (
        name, old_rank, old_scope_mode, old_is_system
      )
      SELECT name, rank, scope_mode, is_system
      FROM roles
      ON CONFLICT (name) DO NOTHING
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_role_scope_migration_backup (
        user_id INTEGER PRIMARY KEY,
        old_role TEXT,
        old_permissions JSONB NOT NULL,
        old_data_scope JSONB NOT NULL
      )
    `);
    await queryRunner.query(
      `
      INSERT INTO user_role_scope_migration_backup (
        user_id, old_role, old_permissions, old_data_scope
      )
      SELECT id, role, COALESCE(permissions, '[]'::jsonb), COALESCE(data_scope, '{}'::jsonb)
      FROM users
      WHERE role = ANY($1::text[])
         OR COALESCE(data_scope, '{}'::jsonb) = '{}'::jsonb
         OR (role = 'STUDENT' AND COALESCE((data_scope ->> 'own_only')::boolean, FALSE) = FALSE)
      ON CONFLICT (user_id) DO NOTHING
    `,
      [LEGACY_ADMIN_ROLES],
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_link_role_scope_migration_backup (
        task_link_id TEXT PRIMARY KEY,
        old_login_role TEXT,
        old_login_permissions JSONB NOT NULL,
        old_login_data_scope JSONB NOT NULL
      )
    `);
    await queryRunner.query(
      `
      INSERT INTO task_link_role_scope_migration_backup (
        task_link_id, old_login_role, old_login_permissions, old_login_data_scope
      )
      SELECT
        id,
        login_role,
        COALESCE(login_permissions, '[]'::jsonb),
        COALESCE(login_data_scope, '{}'::jsonb)
      FROM task_links
      WHERE login_role = ANY($1::text[])
         OR (login_role IS NOT NULL AND COALESCE(login_data_scope, '{}'::jsonb) = '{}'::jsonb)
      ON CONFLICT (task_link_id) DO NOTHING
    `,
      [LEGACY_ADMIN_ROLES],
    );

    await queryRunner.query(
      `
      UPDATE users u
      SET permissions = r.default_permissions
      FROM roles r
      WHERE u.role = r.name
        AND u.role = ANY($1::text[])
        AND COALESCE(u.permissions, '[]'::jsonb) = '[]'::jsonb
    `,
      [LEGACY_ADMIN_ROLES],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET role = 'ADMIN'
      WHERE role = ANY($1::text[])
    `,
      [LEGACY_ADMIN_ROLES],
    );
    await queryRunner.query(`
      UPDATE users
      SET data_scope = (COALESCE(data_scope, '{}'::jsonb) - 'global') || '{"own_only":true}'::jsonb
      WHERE role = 'STUDENT'
        AND COALESCE((data_scope ->> 'own_only')::boolean, FALSE) = FALSE
    `);
    await queryRunner.query(`
      UPDATE users
      SET data_scope = COALESCE(data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
      WHERE role <> 'STUDENT'
        AND COALESCE(data_scope, '{}'::jsonb) = '{}'::jsonb
    `);

    await queryRunner.query(
      `
      UPDATE task_links tl
      SET login_permissions = r.default_permissions
      FROM roles r
      WHERE tl.login_role = r.name
        AND tl.login_role = ANY($1::text[])
        AND COALESCE(tl.login_permissions, '[]'::jsonb) = '[]'::jsonb
    `,
      [LEGACY_ADMIN_ROLES],
    );
    await queryRunner.query(
      `
      UPDATE task_links
      SET login_role = 'ADMIN'
      WHERE login_role = ANY($1::text[])
    `,
      [LEGACY_ADMIN_ROLES],
    );
    await queryRunner.query(`
      UPDATE task_links
      SET login_data_scope =
        CASE
          WHEN login_role = 'STUDENT' THEN
            (COALESCE(login_data_scope, '{}'::jsonb) - 'global') || '{"own_only":true}'::jsonb
          ELSE COALESCE(login_data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
        END
      WHERE login_role IS NOT NULL
        AND COALESCE(login_data_scope, '{}'::jsonb) = '{}'::jsonb
    `);

    await queryRunner.query(`
      UPDATE roles
      SET rank = CASE name
          WHEN 'ADMIN' THEN 5
          WHEN 'DIRECTOR' THEN 4
          WHEN 'EXECUTIVE' THEN 3
          WHEN 'TEACHER' THEN 2
          WHEN 'STUDENT' THEN 1
        END,
        scope_mode = 'flexible',
        scope_policy = CASE WHEN name = 'STUDENT' THEN 'OWN_ONLY' ELSE 'ASSIGNABLE' END,
        is_assignable = TRUE,
        is_system = TRUE
      WHERE name IN ('ADMIN', 'DIRECTOR', 'EXECUTIVE', 'TEACHER', 'STUDENT')
    `);
    await queryRunner.query(
      `
      UPDATE roles
      SET is_assignable = FALSE
      WHERE name = ANY($1::text[])
    `,
      [LEGACY_ADMIN_ROLES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users u
      SET role = backup.old_role,
          permissions = backup.old_permissions,
          data_scope = backup.old_data_scope
      FROM user_role_scope_migration_backup backup
      WHERE u.id = backup.user_id
    `);
    await queryRunner.query(`
      UPDATE task_links tl
      SET login_role = backup.old_login_role,
          login_permissions = backup.old_login_permissions,
          login_data_scope = backup.old_login_data_scope
      FROM task_link_role_scope_migration_backup backup
      WHERE tl.id = backup.task_link_id
    `);
    await queryRunner.query(`
      UPDATE roles r
      SET rank = backup.old_rank,
          scope_mode = backup.old_scope_mode,
          is_system = backup.old_is_system
      FROM role_definition_migration_backup backup
      WHERE r.name = backup.name
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS task_link_role_scope_migration_backup`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_role_scope_migration_backup`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_definition_migration_backup`);
    await queryRunner.query(`ALTER TABLE roles DROP CONSTRAINT IF EXISTS chk_roles_scope_policy`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS is_assignable`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS scope_policy`);
  }
}
