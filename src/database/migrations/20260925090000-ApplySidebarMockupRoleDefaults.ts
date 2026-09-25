import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sets the default menu groups to the sidebar mockups the owner supplied on
 * 2026-09-25 — one per default group:
 *
 * - ผู้ดูแลระบบโรงเรียน (`S<id>_BASE_ADMIN`): management pages of its own school
 * - ผู้อำนวยการ (`DIRECTOR`, `S<id>_BASE_DIRECTOR`): lists only — แชตบอท is
 *   ผู้บริหาร's alone (owner, 2026-09-25)
 * - ผู้บริหารสภา (`EXECUTIVE`): หน้าหลัก, รายงาน, ส่งออก, แชตบอท
 * - ผู้ดูแลระบบสภา (`ADMIN`): unchanged — it already holds every page
 *
 * The lists are written out here rather than imported from
 * `permissions.constants`, so this migration keeps meaning what it meant when a
 * later change edits those constants.
 *
 * `users.permissions` is a materialised copy of what an account may open, so an
 * account in one of these groups is set to its group's new list as well —
 * otherwise its sidebar would keep the old pages. Both are backed up and
 * `down()` puts them back.
 */
const SCHOOL_ADMIN = [
  'home',
  'dashboard',
  'classrooms',
  'manage-users-list',
  'manage-role-groups',
  'manage-school-structure',
  'manage-subjects',
  'manage-teachers',
  'manage-classroom-links',
  'manage-students',
  'import-data',
  'export-data',
  'audit-log',
];
const DIRECTOR = ['home', 'dashboard', 'classrooms', 'teachers', 'students', 'audit-log'];
const EXECUTIVE = ['home', 'dashboard', 'export-data', 'nl_query:use'];

const TARGETS: Array<{ where: string; permissions: string[] }> = [
  { where: `name ~ '^S[0-9]+_BASE_ADMIN$'`, permissions: SCHOOL_ADMIN },
  { where: `(name = 'DIRECTOR' OR name ~ '^S[0-9]+_BASE_DIRECTOR$')`, permissions: DIRECTOR },
  { where: `name = 'EXECUTIVE'`, permissions: EXECUTIVE },
];
const BACKUP_TABLE = 'sidebar_mockup_role_defaults_backup_20260925';

export class ApplySidebarMockupRoleDefaults20260925090000 implements MigrationInterface {
  name = 'ApplySidebarMockupRoleDefaults20260925090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        original JSONB,
        PRIMARY KEY (scope, key)
      )
    `);

    for (const target of TARGETS) {
      const permissions = JSON.stringify(target.permissions);
      await queryRunner.query(`
        INSERT INTO ${BACKUP_TABLE} (scope, key, original)
        SELECT 'role', name, default_permissions
        FROM roles
        WHERE ${target.where}
        ON CONFLICT (scope, key) DO NOTHING
      `);
      await queryRunner.query(`
        INSERT INTO ${BACKUP_TABLE} (scope, key, original)
        SELECT 'user', account.id::text, account.permissions
        FROM users account
        WHERE account.role IN (SELECT name FROM roles WHERE ${target.where})
        ON CONFLICT (scope, key) DO NOTHING
      `);
      await queryRunner.query(
        `UPDATE roles SET default_permissions = $1::jsonb WHERE ${target.where}`,
        [permissions],
      );
      await queryRunner.query(
        `
          UPDATE users
          SET permissions = $1::jsonb
          WHERE role IN (SELECT name FROM roles WHERE ${target.where})
        `,
        [permissions],
      );
    }
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
