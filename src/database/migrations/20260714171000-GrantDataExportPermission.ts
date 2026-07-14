import type { MigrationInterface, QueryRunner } from 'typeorm';

const DATA_EXPORT_PERMISSION = 'export-data';
const DATA_EXPORT_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class GrantDataExportPermission20260714171000 implements MigrationInterface {
  name = 'GrantDataExportPermission20260714171000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([DATA_EXPORT_PERMISSION]), DATA_EXPORT_ROLES, DATA_EXPORT_PERMISSION],
    );

    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND NOT (permissions ? $3)
      `,
      [JSON.stringify([DATA_EXPORT_PERMISSION]), DATA_EXPORT_ROLES, DATA_EXPORT_PERMISSION],
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
      [DATA_EXPORT_PERMISSION, DATA_EXPORT_ROLES],
    );

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [DATA_EXPORT_PERMISSION, DATA_EXPORT_ROLES],
    );
  }
}
