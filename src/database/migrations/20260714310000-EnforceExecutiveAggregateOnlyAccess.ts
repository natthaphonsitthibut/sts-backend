import type { MigrationInterface, QueryRunner } from 'typeorm';

const RAW_EXECUTIVE_PERMISSIONS = [
  'dashboard',
  'students',
  'review-cases',
  'attendance-dashboard',
] as const;

/**
 * Makes P7 aggregate-only the safe default for existing EXECUTIVE accounts.
 * Exact pre-migration permission arrays are retained for a reversible down.
 */
export class EnforceExecutiveAggregateOnlyAccess20260714310000 implements MigrationInterface {
  name = 'EnforceExecutiveAggregateOnlyAccess20260714310000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE executive_aggregate_permission_backups (
        id BIGSERIAL PRIMARY KEY,
        role_name VARCHAR(64),
        user_id INTEGER,
        original_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_executive_permission_backup_role
          FOREIGN KEY (role_name) REFERENCES roles(name)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_executive_permission_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_executive_permission_backup_owner
          CHECK ((role_name IS NULL) <> (user_id IS NULL)),
        CONSTRAINT chk_executive_permission_backup_json
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT uq_executive_permission_backup_role UNIQUE (role_name),
        CONSTRAINT uq_executive_permission_backup_user UNIQUE (user_id)
      );

      INSERT INTO executive_aggregate_permission_backups (role_name, original_permissions)
      SELECT name, COALESCE(default_permissions, '[]'::jsonb)
      FROM roles
      WHERE name = 'EXECUTIVE';

      INSERT INTO executive_aggregate_permission_backups (user_id, original_permissions)
      SELECT id, COALESCE(permissions, '[]'::jsonb)
      FROM users
      WHERE role = 'EXECUTIVE';
    `);

    const removalSql = RAW_EXECUTIVE_PERMISSIONS.map((permission) => ` - '${permission}'`).join('');
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions =
        (COALESCE(default_permissions, '[]'::jsonb)${removalSql} - 'home' - 'executive-report')
        || '["home", "executive-report"]'::jsonb
      WHERE name = 'EXECUTIVE';

      UPDATE users
      SET permissions =
        (COALESCE(permissions, '[]'::jsonb)${removalSql} - 'home' - 'executive-report')
        || '["home", "executive-report"]'::jsonb
      WHERE role = 'EXECUTIVE';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles role_record
      SET default_permissions = backup.original_permissions
      FROM executive_aggregate_permission_backups backup
      WHERE backup.role_name = role_record.name;

      UPDATE users user_record
      SET permissions = backup.original_permissions
      FROM executive_aggregate_permission_backups backup
      WHERE backup.user_id = user_record.id;

      DROP TABLE executive_aggregate_permission_backups;
    `);
  }
}
