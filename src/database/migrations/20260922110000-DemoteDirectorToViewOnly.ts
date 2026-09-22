import type { MigrationInterface, QueryRunner } from 'typeorm';

// ผอ. เหลือแค่รายชื่อ ส่วนสิทธิ์จัดการอยู่ที่ ADMIN (owner, 2026-09-22).
// The school-specific director groups use S<id>_BASE_DIRECTOR and must follow
// the same rule as the global DIRECTOR role.
const DEMOTED_PERMISSIONS = [
  'manage-students',
  'manage-classroom-links',
  'manage-school-structure',
  'manage-subjects',
  'manage-users-list',
  'manage-teachers',
  'manage-schools',
];
const BACKUP_TABLE = 'director_permission_demotion_backup_20260922';

export class DemoteDirectorToViewOnly20260922110000 implements MigrationInterface {
  name = 'DemoteDirectorToViewOnly20260922110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        original JSONB NOT NULL,
        PRIMARY KEY (scope, key)
      )
    `);
    await queryRunner.query(
      `
        INSERT INTO ${BACKUP_TABLE} (scope, key, original)
        SELECT 'role', name, COALESCE(default_permissions, '[]'::jsonb)
        FROM roles
        WHERE (name = 'DIRECTOR' OR name ~ '^S[0-9]+_BASE_DIRECTOR$')
          AND jsonb_typeof(default_permissions) = 'array'
          AND default_permissions ?| $1::text[]
        ON CONFLICT (scope, key) DO NOTHING
      `,
      [DEMOTED_PERMISSIONS],
    );
    await queryRunner.query(
      `
        INSERT INTO ${BACKUP_TABLE} (scope, key, original)
        SELECT 'user', id::text, COALESCE(permissions, '[]'::jsonb)
        FROM users
        WHERE (role = 'DIRECTOR' OR role ~ '^S[0-9]+_BASE_DIRECTOR$')
          AND jsonb_typeof(permissions) = 'array'
          AND permissions ?| $1::text[]
        ON CONFLICT (scope, key) DO NOTHING
      `,
      [DEMOTED_PERMISSIONS],
    );
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = COALESCE(
          (
            SELECT jsonb_agg(permission ORDER BY permission)
            FROM jsonb_array_elements_text(default_permissions) AS permission
            WHERE NOT (permission = ANY($1::text[]))
          ),
          '[]'::jsonb
        )
        WHERE (name = 'DIRECTOR' OR name ~ '^S[0-9]+_BASE_DIRECTOR$')
          AND jsonb_typeof(default_permissions) = 'array'
          AND default_permissions ?| $1::text[]
      `,
      [DEMOTED_PERMISSIONS],
    );
    await queryRunner.query(
      `
        UPDATE users account
        SET permissions = COALESCE(
          (
            SELECT jsonb_agg(permission ORDER BY permission)
            FROM jsonb_array_elements_text(account.permissions) AS permission
            WHERE NOT (permission = ANY($1::text[]))
          ),
          '[]'::jsonb
        )
        WHERE (account.role = 'DIRECTOR' OR account.role ~ '^S[0-9]+_BASE_DIRECTOR$')
          AND jsonb_typeof(account.permissions) = 'array'
          AND account.permissions ?| $1::text[]
      `,
      [DEMOTED_PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.original
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'role' AND backup.key = target.name
    `);
    await queryRunner.query(`
      UPDATE users account
      SET permissions = backup.original
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'user' AND backup.key = account.id::text
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  }
}
