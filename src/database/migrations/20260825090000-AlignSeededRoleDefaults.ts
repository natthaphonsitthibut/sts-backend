import type { MigrationInterface, QueryRunner } from 'typeorm';
import { SYSTEM_ROLE_DEFINITIONS } from '../../auth/permissions.constants';

/**
 * Puts the seeded role defaults back on the baseline the code declares.
 *
 * `SYSTEM_ROLE_DEFINITIONS` says ผู้บริหาร holds หน้าหลัก and nothing else, but the
 * database says หน้าหลัก + ตารางสอน: the page collapse (20260821090000) granted
 * ตารางสอน to every role that held หน้าหลัก, because ตารางสอน had no permission of
 * its own and rode on หน้าหลัก. That was right for everyone who could already open
 * the page and wrong for ผู้บริหาร, which reached it for the first time as a side
 * effect — timetables are ผอ.'s to arrange (owner, 2026-08-17).
 *
 * So this is not a new policy, it is the seed being applied: for the system roles
 * only, `default_permissions` is set to the declared baseline. Per-school groups
 * copied from those templates are corrected for this one page rather than reseeded,
 * because an operator may have edited them on purpose and a blanket reseed would
 * throw that away.
 *
 * `users.permissions` is a materialised copy of what the account may open, so an
 * account in one of those groups is trimmed too — otherwise the menu stays on
 * screen and every request behind it answers 403.
 */
const EXECUTIVE_GROUPS = `(name = 'EXECUTIVE' OR name ~ '^S[0-9]+_BASE_EXECUTIVE$')`;

export class AlignSeededRoleDefaults20260825090000 implements MigrationInterface {
  name = 'AlignSeededRoleDefaults20260825090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        CREATE TABLE IF NOT EXISTS role_default_alignment_backup_20260825 (
          name TEXT PRIMARY KEY,
          original JSONB NOT NULL
        )
      `,
    );
    await queryRunner.query(`
      INSERT INTO role_default_alignment_backup_20260825 (name, original)
      SELECT name, COALESCE(default_permissions, '[]'::jsonb)
      FROM roles
      WHERE is_system OR ${EXECUTIVE_GROUPS}
      ON CONFLICT (name) DO NOTHING
    `);

    // System roles are seeded, not operator-owned: set them to the baseline.
    for (const role of SYSTEM_ROLE_DEFINITIONS) {
      await queryRunner.query(
        `UPDATE roles SET default_permissions = $2::jsonb WHERE name = $1 AND is_system`,
        [role.name, JSON.stringify(role.default_permissions)],
      );
    }

    // A school's own ผู้บริหาร group is a copy of that template, so it inherited
    // the same stray page. Correct only that page.
    await queryRunner.query(`
      UPDATE roles
      SET default_permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(default_permissions) AS permission
          WHERE permission <> 'timetable'
        ),
        '[]'::jsonb
      )
      WHERE ${EXECUTIVE_GROUPS} AND default_permissions ? 'timetable'
    `);

    await queryRunner.query(`
      UPDATE users account
      SET permissions = COALESCE(
        (
          SELECT jsonb_agg(permission ORDER BY permission)
          FROM jsonb_array_elements_text(account.permissions) AS permission
          WHERE permission <> 'timetable'
        ),
        '[]'::jsonb
      )
      WHERE account.role IN (SELECT name FROM roles WHERE ${EXECUTIVE_GROUPS})
        AND COALESCE(account.permissions, '[]'::jsonb) ? 'timetable'
    `);

    await queryRunner.query(`
      DO $$
      DECLARE empty_groups TEXT;
      BEGIN
        SELECT string_agg(name, ', ') INTO empty_groups
        FROM roles
        WHERE is_assignable
          AND jsonb_array_length(COALESCE(default_permissions, '[]'::jsonb)) = 0;
        IF empty_groups IS NOT NULL THEN
          RAISE EXCEPTION 'กลุ่มเมนูที่เลือกได้ต้องมีสิทธิ์อย่างน้อยหนึ่งหน้า: %', empty_groups;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.original
      FROM role_default_alignment_backup_20260825 backup
      WHERE backup.name = target.name
    `);
    await queryRunner.query(`
      UPDATE users account
      SET permissions = COALESCE(account.permissions, '[]'::jsonb) || '["timetable"]'::jsonb
      WHERE account.role IN (SELECT name FROM roles WHERE ${EXECUTIVE_GROUPS})
        AND NOT (COALESCE(account.permissions, '[]'::jsonb) ? 'timetable')
        AND (SELECT original FROM role_default_alignment_backup_20260825 backup
             WHERE backup.name = account.role) ? 'timetable'
    `);
  }
}
