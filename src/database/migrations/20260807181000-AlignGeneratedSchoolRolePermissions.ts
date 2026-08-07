import type { MigrationInterface, QueryRunner } from 'typeorm';

const LATER_ADDED_SCHOOL_ADMIN_PERMISSIONS = [
  'manage-teachers',
  'manage-curriculum',
  'manage-teacher-access',
] as const;

/** Aligns untouched generated school baselines with their current global templates. */
export class AlignGeneratedSchoolRolePermissions20260807181000 implements MigrationInterface {
  name = 'AlignGeneratedSchoolRolePermissions20260807181000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE school_role_permission_alignment_backups_20260807 (
        role_id INTEGER PRIMARY KEY,
        original_permissions JSONB NOT NULL,
        aligned_permissions JSONB NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_school_role_permission_alignment_backup_role
          FOREIGN KEY (role_id) REFERENCES roles(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_school_role_permission_alignment_original_array
          CHECK (jsonb_typeof(original_permissions) = 'array'),
        CONSTRAINT chk_school_role_permission_alignment_value_array
          CHECK (jsonb_typeof(aligned_permissions) = 'array')
      )
    `);

    await queryRunner.query(
      `
        WITH global_templates AS (
          SELECT name, default_permissions
          FROM roles
          WHERE school_id IS NULL
            AND name IN ('ADMIN', 'DIRECTOR')
        ),
        candidates AS (
          SELECT
            generated_role.id AS role_id,
            generated_role.default_permissions AS original_permissions,
            global_role.default_permissions AS aligned_permissions
          FROM roles generated_role
          JOIN global_templates global_role
            ON global_role.name = CASE
              WHEN generated_role.name ~ '^S[0-9]+_BASE_ADMIN$' THEN 'ADMIN'
              WHEN generated_role.name ~ '^S[0-9]+_BASE_DIRECTOR$' THEN 'DIRECTOR'
              ELSE NULL
            END
          WHERE generated_role.school_id IS NOT NULL
            AND generated_role.default_permissions = (
              global_role.default_permissions
              - $1::text
              - $2::text
              - $3::text
            )
            AND generated_role.default_permissions IS DISTINCT FROM global_role.default_permissions
        )
        INSERT INTO school_role_permission_alignment_backups_20260807 (
          role_id,
          original_permissions,
          aligned_permissions
        )
        SELECT role_id, original_permissions, aligned_permissions
        FROM candidates
      `,
      [...LATER_ADDED_SCHOOL_ADMIN_PERMISSIONS],
    );

    await queryRunner.query(`
      UPDATE roles role_record
      SET default_permissions = backup.aligned_permissions
      FROM school_role_permission_alignment_backups_20260807 backup
      WHERE backup.role_id = role_record.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles role_record
      SET default_permissions = backup.original_permissions
      FROM school_role_permission_alignment_backups_20260807 backup
      WHERE backup.role_id = role_record.id
        AND role_record.default_permissions = backup.aligned_permissions
    `);

    await queryRunner.query(`DROP TABLE school_role_permission_alignment_backups_20260807`);
  }
}
