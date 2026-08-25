import type { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_PERMISSION = 'manage-teacher-access';
const NEW_PERMISSION = 'manage-classroom-links';

function renamePermission(source: string, from: string, to: string): string {
  return `(
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb)
    FROM (
      SELECT DISTINCT CASE WHEN item.value = '${from}' THEN '${to}' ELSE item.value END AS value
      FROM jsonb_array_elements_text(COALESCE(${source}, '[]'::jsonb)) item(value)
    ) renamed
  )`;
}

export class RenameClassroomLinkPermission20260827220000 implements MigrationInterface {
  name = 'RenameClassroomLinkPermission20260827220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users
       SET permissions = ${renamePermission('users.permissions', OLD_PERMISSION, NEW_PERMISSION)}
       WHERE COALESCE(permissions, '[]'::jsonb) ? '${OLD_PERMISSION}'`,
    );
    await queryRunner.query(
      `UPDATE roles
       SET default_permissions = ${renamePermission(
         'roles.default_permissions',
         OLD_PERMISSION,
         NEW_PERMISSION,
       )}
       WHERE COALESCE(default_permissions, '[]'::jsonb) ? '${OLD_PERMISSION}'`,
    );
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = default_permissions || '["${NEW_PERMISSION}"]'::jsonb
      WHERE name IN ('ADMIN', 'DIRECTOR')
        AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? '${NEW_PERMISSION}')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users
       SET permissions = ${renamePermission('users.permissions', NEW_PERMISSION, OLD_PERMISSION)}
       WHERE COALESCE(permissions, '[]'::jsonb) ? '${NEW_PERMISSION}'`,
    );
    await queryRunner.query(
      `UPDATE roles
       SET default_permissions = ${renamePermission(
         'roles.default_permissions',
         NEW_PERMISSION,
         OLD_PERMISSION,
       )}
       WHERE COALESCE(default_permissions, '[]'::jsonb) ? '${NEW_PERMISSION}'`,
    );
  }
}
