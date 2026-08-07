import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Preserves the effective access of legacy accounts before an empty JSON array
 * becomes an intentional "no permissions" assignment at runtime.
 */
export class MaterializeLegacyUserPermissions20260807180000 implements MigrationInterface {
  name = 'MaterializeLegacyUserPermissions20260807180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_permission_materialization_backups_20260807 (
        user_id INTEGER PRIMARY KEY,
        original_permissions JSONB NOT NULL,
        materialized_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_user_permission_materialization_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_user_permission_materialization_original_array
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT chk_user_permission_materialization_value_array
          CHECK (jsonb_typeof(materialized_permissions) = 'array')
      )
    `);

    await queryRunner.query(`
      INSERT INTO user_permission_materialization_backups_20260807 (
        user_id,
        original_permissions,
        materialized_permissions
      )
      SELECT
        user_record.id,
        user_record.permissions,
        role_record.default_permissions
      FROM users user_record
      JOIN roles role_record ON role_record.name = user_record.role
      WHERE jsonb_typeof(user_record.permissions) = 'array'
        AND jsonb_array_length(user_record.permissions) = 0
        AND jsonb_typeof(role_record.default_permissions) = 'array'
        AND jsonb_array_length(role_record.default_permissions) > 0
    `);

    await queryRunner.query(`
      UPDATE users user_record
      SET permissions = backup.materialized_permissions
      FROM user_permission_materialization_backups_20260807 backup
      WHERE backup.user_id = user_record.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users user_record
      SET permissions = backup.original_permissions
      FROM user_permission_materialization_backups_20260807 backup
      WHERE backup.user_id = user_record.id
        AND user_record.permissions = backup.materialized_permissions
    `);

    await queryRunner.query(`DROP TABLE user_permission_materialization_backups_20260807`);
  }
}
