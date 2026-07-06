import type { MigrationInterface, QueryRunner } from 'typeorm';

const FIELD_MONITOR_PERMISSION = 'field-monitor';
const FIELD_MONITOR_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class GrantFieldMonitorPermission20260706210000 implements MigrationInterface {
  name = 'GrantFieldMonitorPermission20260706210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([FIELD_MONITOR_PERMISSION]), FIELD_MONITOR_ROLES, FIELD_MONITOR_PERMISSION],
    );

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND NOT (permissions ? $3)
      `,
      [JSON.stringify([FIELD_MONITOR_PERMISSION]), FIELD_MONITOR_ROLES, FIELD_MONITOR_PERMISSION],
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
      [FIELD_MONITOR_PERMISSION, FIELD_MONITOR_ROLES],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [FIELD_MONITOR_PERMISSION, FIELD_MONITOR_ROLES],
    );
  }
}
