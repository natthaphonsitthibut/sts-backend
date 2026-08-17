import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Student accounts and Mock ThaID were removed in the preceding retirement
 * migration. This final contract migration removes the last persisted
 * `student-self` grant so no stale account or role can regain the retired
 * route. The JSONB transform is reversible: down only restores the catalog
 * permission to the legacy STUDENT role if that role still exists.
 */
export class RetireStudentSelfLogin20260823160000 implements MigrationInterface {
  name = 'RetireStudentSelfLogin20260823160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
      SET permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(COALESCE(users.permissions, '[]'::jsonb)) AS permission
          WHERE permission <> 'student-self'
        ),
        '[]'::jsonb
      )
      WHERE COALESCE(users.permissions, '[]'::jsonb) ? 'student-self'
    `);
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(COALESCE(roles.default_permissions, '[]'::jsonb)) AS permission
          WHERE permission <> 'student-self'
        ),
        '[]'::jsonb
      )
      WHERE COALESCE(roles.default_permissions, '[]'::jsonb) ? 'student-self'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = CASE
        WHEN COALESCE(default_permissions, '[]'::jsonb) ? 'student-self' THEN default_permissions
        ELSE COALESCE(default_permissions, '[]'::jsonb) || '["student-self"]'::jsonb
      END
      WHERE name = 'STUDENT'
    `);
  }
}
