import type { MigrationInterface, QueryRunner } from 'typeorm';

const CALENDAR_ADMIN_PERMISSION = 'manage-attendance-calendar';
const CALENDAR_ADMIN_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class GrantAttendanceCalendarPermission20260706100000 implements MigrationInterface {
  name = 'GrantAttendanceCalendarPermission20260706100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [
        JSON.stringify([CALENDAR_ADMIN_PERMISSION]),
        CALENDAR_ADMIN_ROLES,
        CALENDAR_ADMIN_PERMISSION,
      ],
    );

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND jsonb_array_length(permissions) > 0
          AND permissions ? 'settings'
          AND NOT (permissions ? $3)
      `,
      [
        JSON.stringify([CALENDAR_ADMIN_PERMISSION]),
        CALENDAR_ADMIN_ROLES,
        CALENDAR_ADMIN_PERMISSION,
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
      [CALENDAR_ADMIN_PERMISSION, CALENDAR_ADMIN_ROLES],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [CALENDAR_ADMIN_PERMISSION, CALENDAR_ADMIN_ROLES],
    );
  }
}
