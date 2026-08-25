import type { MigrationInterface, QueryRunner } from 'typeorm';

const BACKUP_TABLE = 'student_teacher_permission_split_backup_20260827';

function addPermission(source: string, existing: string, added: string): string {
  return `(
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT DISTINCT item.value
      FROM jsonb_array_elements_text(COALESCE(${source}, '[]'::jsonb)) item(value)
      UNION
      SELECT '${added}'
      WHERE COALESCE(${source}, '[]'::jsonb) ? '${existing}'
    ) expanded
  )`;
}

/**
 * Splits read-only directory pages from mutation-capable management pages.
 * Existing grants expand to both halves so deployment removes no capability;
 * administrators can narrow each role afterward.
 */
export class SplitStudentTeacherPermissions20260827312200 implements MigrationInterface {
  name = 'SplitStudentTeacherPermissions20260827312200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ${BACKUP_TABLE} (
        scope VARCHAR(16) NOT NULL,
        record_key VARCHAR(255) NOT NULL,
        original_permissions JSONB NOT NULL,
        CONSTRAINT pk_student_teacher_permission_split_backup PRIMARY KEY (scope, record_key),
        CONSTRAINT chk_student_teacher_permission_split_backup_scope
          CHECK (scope IN ('USER', 'ROLE'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (scope, record_key, original_permissions)
      SELECT 'USER', id::text, COALESCE(permissions, '[]'::jsonb) FROM users
      UNION ALL
      SELECT 'ROLE', name, COALESCE(default_permissions, '[]'::jsonb) FROM roles
    `);
    await queryRunner.query(`
      UPDATE users
      SET permissions = ${addPermission(
        addPermission('users.permissions', 'students', 'manage-students'),
        'manage-teachers',
        'teachers',
      )}
      WHERE COALESCE(permissions, '[]'::jsonb) ?| ARRAY['students', 'manage-teachers']
    `);
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = ${addPermission(
        addPermission('roles.default_permissions', 'students', 'manage-students'),
        'manage-teachers',
        'teachers',
      )}
      WHERE COALESCE(default_permissions, '[]'::jsonb) ?| ARRAY['students', 'manage-teachers']
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users target
      SET permissions = backup.original_permissions
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'USER' AND backup.record_key = target.id::text
    `);
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.original_permissions
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'ROLE' AND backup.record_key = target.name
    `);
    await queryRunner.query(`DROP TABLE ${BACKUP_TABLE}`);
  }
}
