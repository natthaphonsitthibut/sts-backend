import type { MigrationInterface, QueryRunner } from 'typeorm';

const MANAGE_SCHOOLS_PERMISSION = 'manage-schools';
const MANAGE_SCHOOLS_ROLES = ['ADMIN'] as const;

/**
 * New page (เมนูส่วนสภา's "จัดการข้อมูลโรงเรียน", owner 2026-09-22) — global-only,
 * ADMIN. Existing `roles`/`users` rows carry a snapshot of permissions taken
 * when they were created, so a new page needs backfilling into both, the
 * same as `20260831210000-AddNlQuery` did for nl_query:use.
 */
export class AddManageSchoolsPermission20260922100000 implements MigrationInterface {
  name = 'AddManageSchoolsPermission20260922100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? $3)
      `,
      [
        JSON.stringify([MANAGE_SCHOOLS_PERMISSION]),
        MANAGE_SCHOOLS_ROLES,
        MANAGE_SCHOOLS_PERMISSION,
      ],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND NOT (permissions ? $3)
      `,
      [
        JSON.stringify([MANAGE_SCHOOLS_PERMISSION]),
        MANAGE_SCHOOLS_ROLES,
        MANAGE_SCHOOLS_PERMISSION,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions - $1
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
      `,
      [MANAGE_SCHOOLS_PERMISSION, MANAGE_SCHOOLS_ROLES],
    );
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [MANAGE_SCHOOLS_PERMISSION, MANAGE_SCHOOLS_ROLES],
    );
  }
}
