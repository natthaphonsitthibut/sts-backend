import type { MigrationInterface, QueryRunner } from 'typeorm';

const RETIRED_PERMISSIONS = [
  'manage-student-accounts',
  'login-links',
  'manage-teacher-access',
] as const;

/**
 * Retires persistent student accounts and account-login-link permissions while
 * retaining all historical domain rows. Backup tables make the permission and
 * account-state change exactly reversible without dropping business history.
 */
export class RetireStudentAccountsAndLoginLinks20260802150000 implements MigrationInterface {
  name = 'RetireStudentAccountsAndLoginLinks20260802150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE retired_student_account_user_backup_20260802 (
        user_id INTEGER PRIMARY KEY REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        status TEXT NOT NULL,
        permissions JSONB NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE retired_access_role_backup_20260802 (
        role_id INTEGER PRIMARY KEY REFERENCES roles(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        default_permissions JSONB NOT NULL,
        is_assignable BOOLEAN NOT NULL
      )
    `);

    await queryRunner.query(
      `
        INSERT INTO retired_student_account_user_backup_20260802
          (user_id, status, permissions)
        SELECT id, status, COALESCE(permissions, '[]'::jsonb)
        FROM users
        WHERE role = 'STUDENT'
           OR COALESCE(permissions, '[]'::jsonb) ?| $1::text[]
      `,
      [RETIRED_PERMISSIONS],
    );
    await queryRunner.query(
      `
        INSERT INTO retired_access_role_backup_20260802
          (role_id, default_permissions, is_assignable)
        SELECT id, COALESCE(default_permissions, '[]'::jsonb), is_assignable
        FROM roles
        WHERE name = 'STUDENT'
           OR COALESCE(default_permissions, '[]'::jsonb) ?| $1::text[]
      `,
      [RETIRED_PERMISSIONS],
    );

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = COALESCE((
          SELECT jsonb_agg(permission ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(users.permissions, '[]'::jsonb))
            WITH ORDINALITY AS value(permission, ord)
          WHERE NOT (permission = ANY($1::text[]))
        ), '[]'::jsonb),
        status = CASE WHEN role = 'STUDENT' THEN 'DISABLED' ELSE status END
        WHERE role = 'STUDENT'
           OR COALESCE(permissions, '[]'::jsonb) ?| $1::text[]
      `,
      [RETIRED_PERMISSIONS],
    );
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = COALESCE((
          SELECT jsonb_agg(permission ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(roles.default_permissions, '[]'::jsonb))
            WITH ORDINALITY AS value(permission, ord)
          WHERE NOT (permission = ANY($1::text[]))
            AND NOT (roles.name = 'STUDENT' AND permission = 'student-self')
        ), '[]'::jsonb),
        is_assignable = CASE WHEN name = 'STUDENT' THEN FALSE ELSE is_assignable END
        WHERE name = 'STUDENT'
           OR COALESCE(default_permissions, '[]'::jsonb) ?| $1::text[]
      `,
      [RETIRED_PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users target
      SET status = backup.status,
          permissions = backup.permissions
      FROM retired_student_account_user_backup_20260802 backup
      WHERE target.id = backup.user_id
    `);
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.default_permissions,
          is_assignable = backup.is_assignable
      FROM retired_access_role_backup_20260802 backup
      WHERE target.id = backup.role_id
    `);
    await queryRunner.query(`DROP TABLE retired_access_role_backup_20260802`);
    await queryRunner.query(`DROP TABLE retired_student_account_user_backup_20260802`);
  }
}
