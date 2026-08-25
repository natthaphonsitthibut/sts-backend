import type { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_PERMISSIONS = ['manage-curriculum', 'timetable'] as const;
const TARGET_PERMISSION = 'manage-subjects';

function collapsePermissions(source: string): string {
  return `(
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE
        WHEN item.value IN ('${LEGACY_PERMISSIONS.join("', '")}') THEN '${TARGET_PERMISSION}'
        ELSE item.value
      END AS value
      FROM jsonb_array_elements_text(COALESCE(${source}, '[]'::jsonb)) item(value)
    ) collapsed
  )`;
}

function expandPermissions(source: string): string {
  return `(
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT DISTINCT expanded.value
      FROM jsonb_array_elements_text(COALESCE(${source}, '[]'::jsonb)) item(value)
      CROSS JOIN LATERAL (
        SELECT legacy.value
        FROM unnest(
          CASE
            WHEN item.value = '${TARGET_PERMISSION}'
              THEN ARRAY['${LEGACY_PERMISSIONS.join("', '")}']::text[]
            ELSE ARRAY[item.value]::text[]
          END
        ) legacy(value)
      ) expanded
    ) restored
  )`;
}

export class RenameSubjectPermission20260827250000 implements MigrationInterface {
  name = 'RenameSubjectPermission20260827250000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users
       SET permissions = ${collapsePermissions('users.permissions')}
       WHERE COALESCE(permissions, '[]'::jsonb) ?| ARRAY['${LEGACY_PERMISSIONS.join("', '")}']`,
    );
    await queryRunner.query(
      `UPDATE roles
       SET default_permissions = ${collapsePermissions('roles.default_permissions')}
       WHERE COALESCE(default_permissions, '[]'::jsonb) ?| ARRAY['${LEGACY_PERMISSIONS.join("', '")}']`,
    );
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions || '["${TARGET_PERMISSION}"]'::jsonb
      WHERE name IN ('ADMIN', 'DIRECTOR')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? '${TARGET_PERMISSION}')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users
       SET permissions = ${expandPermissions('users.permissions')}
       WHERE COALESCE(permissions, '[]'::jsonb) ? '${TARGET_PERMISSION}'`,
    );
    await queryRunner.query(
      `UPDATE roles
       SET default_permissions = ${expandPermissions('roles.default_permissions')}
       WHERE COALESCE(default_permissions, '[]'::jsonb) ? '${TARGET_PERMISSION}'`,
    );
  }
}
