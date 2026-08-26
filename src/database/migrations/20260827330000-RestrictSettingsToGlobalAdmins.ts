import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ตั้งค่าระบบ is one shared set of values for every school, so its controller
 * now answers only to the ADMIN role holding national scope (owner, 2026-08-27).
 * `RolesGuard` matches the role name literally, which means a school's own
 * `S<id>_BASE_ADMIN` group and every ผอ. group can never pass it.
 *
 * The seed already dropped the page from the ผอ. baseline; this takes the same
 * page off the rows the database is still carrying, so the role editor stops
 * offering a tick that grants nothing and `users.permissions` stops advertising
 * a page whose every request answers 403.
 */
const BACKUP_TABLE = 'settings_permission_scope_backup_20260827';

export class RestrictSettingsToGlobalAdmins20260827330000 implements MigrationInterface {
  name = 'RestrictSettingsToGlobalAdmins20260827330000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        original JSONB NOT NULL,
        PRIMARY KEY (scope, key)
      )
    `);
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (scope, key, original)
      SELECT 'role', name, COALESCE(default_permissions, '[]'::jsonb)
      FROM roles
      WHERE name <> 'ADMIN' AND COALESCE(default_permissions, '[]'::jsonb) ? 'settings'
      ON CONFLICT (scope, key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (scope, key, original)
      SELECT 'user', id::text, COALESCE(permissions, '[]'::jsonb)
      FROM users
      WHERE role IS DISTINCT FROM 'ADMIN' AND COALESCE(permissions, '[]'::jsonb) ? 'settings'
      ON CONFLICT (scope, key) DO NOTHING
    `);

    // A group whose only page is ตั้งค่าระบบ would be left granting nothing, and
    // an assignable group that opens no page is a dead end an operator cannot
    // see. Stop instead of quietly creating one.
    await queryRunner.query(`
      DO $guard$
      DECLARE stranded TEXT;
      BEGIN
        SELECT string_agg(name, ', ') INTO stranded
        FROM roles
        WHERE is_assignable
          AND name <> 'ADMIN'
          AND COALESCE(default_permissions, '[]'::jsonb) ? 'settings'
          AND jsonb_array_length(COALESCE(default_permissions, '[]'::jsonb)) = 1;
        IF stranded IS NOT NULL THEN
          RAISE EXCEPTION
            'กลุ่มเมนูที่มีแต่หน้าตั้งค่าระบบจะไม่เหลือสิทธิ์ใด ๆ: %', stranded;
        END IF;
      END
      $guard$;
    `);

    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(default_permissions) AS permission
          WHERE permission <> 'settings'
        ),
        '[]'::jsonb
      )
      WHERE name <> 'ADMIN' AND COALESCE(default_permissions, '[]'::jsonb) ? 'settings'
    `);

    // `users.permissions` is a materialised copy of what the account may open,
    // so it has to lose the page too or the account keeps carrying it.
    await queryRunner.query(`
      UPDATE users account
      SET permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(account.permissions) AS permission
          WHERE permission <> 'settings'
        ),
        '[]'::jsonb
      )
      WHERE account.role IS DISTINCT FROM 'ADMIN'
        AND COALESCE(account.permissions, '[]'::jsonb) ? 'settings'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.original
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'role' AND backup.key = target.name
    `);
    await queryRunner.query(`
      UPDATE users account
      SET permissions = backup.original
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'user' AND backup.key = account.id::text
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  }
}
