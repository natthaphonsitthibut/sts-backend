import type { MigrationInterface, QueryRunner } from 'typeorm';

const MANAGE_TIMETABLE_PERMISSION = 'manage-timetable';
const MANAGE_TIMETABLE_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class GrantManageTimetablePermission20260707240000 implements MigrationInterface {
  name = 'GrantManageTimetablePermission20260707240000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [
        JSON.stringify([MANAGE_TIMETABLE_PERMISSION]),
        MANAGE_TIMETABLE_ROLES,
        MANAGE_TIMETABLE_PERMISSION,
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
        JSON.stringify([MANAGE_TIMETABLE_PERMISSION]),
        MANAGE_TIMETABLE_ROLES,
        MANAGE_TIMETABLE_PERMISSION,
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
      [MANAGE_TIMETABLE_PERMISSION, MANAGE_TIMETABLE_ROLES],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [MANAGE_TIMETABLE_PERMISSION, MANAGE_TIMETABLE_ROLES],
    );
  }
}
