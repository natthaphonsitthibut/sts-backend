import type { MigrationInterface, QueryRunner } from 'typeorm';

const PAGE_ID = 'attendance';
const BACKUP_TABLE = 'attendance_opt_in_backup_20260926';

/**
 * เช็กชื่อ is an opt-in page (owner, 2026-09-26): no default group has it —
 * teachers check in through their classroom links, not admin accounts — and a
 * school adds it to its own group when it wants one.
 *
 * Every group that currently holds it is a default group that inherited it:
 * council ผู้ดูแลระบบ (`ADMIN`, which took every page), each area's copy of it
 * (`A<code>_BASE_ADMIN`) and the four retired `ADMIN_<level>` groups; school
 * groups (`S<id>_BASE_*`) never had it. The page is removed from those groups
 * and from `users.permissions` (the materialised copy the sidebar reads) of the
 * accounts in them. Both are backed up and `down()` puts them back.
 */
export class MakeAttendancePageOptIn20260926140000 implements MigrationInterface {
  name = 'MakeAttendancePageOptIn20260926140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        scope TEXT NOT NULL CHECK (scope IN ('role', 'user')),
        key TEXT NOT NULL,
        original JSONB,
        PRIMARY KEY (scope, key)
      )
    `);
    await queryRunner.query(
      `
      CREATE TEMP TABLE attendance_default_roles ON COMMIT DROP AS
      SELECT name
      FROM roles
      WHERE name = 'ADMIN'
         OR name ~ '^A[0-9]+_BASE_ADMIN$'
         OR name IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
    `,
    );
    await queryRunner.query(
      `
      INSERT INTO ${BACKUP_TABLE} (scope, key, original)
      SELECT 'role', role.name, role.default_permissions
      FROM roles role
      WHERE role.name IN (SELECT name FROM attendance_default_roles)
        AND role.default_permissions ? $1
      ON CONFLICT (scope, key) DO NOTHING
    `,
      [PAGE_ID],
    );
    await queryRunner.query(
      `
      INSERT INTO ${BACKUP_TABLE} (scope, key, original)
      SELECT 'user', account.id::text, account.permissions
      FROM users account
      WHERE account.role IN (SELECT name FROM attendance_default_roles)
        AND account.permissions ? $1
      ON CONFLICT (scope, key) DO NOTHING
    `,
      [PAGE_ID],
    );
    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = default_permissions - $1::text
      WHERE name IN (SELECT name FROM attendance_default_roles)
        AND default_permissions ? $1
    `,
      [PAGE_ID],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET permissions = permissions - $1::text
      WHERE role IN (SELECT name FROM attendance_default_roles)
        AND permissions ? $1
    `,
      [PAGE_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE roles role
      SET default_permissions = backup.original
      FROM ${BACKUP_TABLE} backup
      WHERE backup.scope = 'role' AND backup.key = role.name
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
