import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reading a case and acting on it become separate permissions (owner,
 * 2026-09-28). `dashboard` (รายงานสถานะนักเรียน) keeps opening cases; assigning
 * a round (`case:assign`) and reviewing a report (`case:review`) are the ผอ.'s.
 * The whole บันทึกการใช้งาน page gets its own `audit-log:all`, held by every
 * default ผู้ดูแลระบบ group (`audit-log` alone keeps the history panels).
 *
 * Default groups gain their new permissions, then every account's materialised
 * `users.permissions` is reset to its group's defaults — except `newnewnew`, the
 * owner's sandbox account, which keeps what it has and gains all three.
 * `case_review_actions` buttons now ask for `case:review`.
 *
 * Data only: no table or column changes. Before this runs every account's
 * permissions equalled its group's defaults (checked 2026-09-28), so `down()`
 * restores the previous state by removing the three ids again.
 */
const NEW_PERMISSIONS = ['case:assign', 'case:review', 'audit-log:all'];
const DIRECTOR_ADDED = ['case:assign', 'case:review'];
const ADMIN_ADDED = ['audit-log:all'];
const SANDBOX_USERNAME = 'newnewnew';

const appendMissing = (column: string) => `
  ${column} || COALESCE((
    SELECT jsonb_agg(permission)
    FROM jsonb_array_elements_text($1::jsonb) AS added(permission)
    WHERE NOT (${column} ? permission)
  ), '[]'::jsonb)`;

export class SplitCaseActionPermissions20260928120000 implements MigrationInterface {
  name = 'SplitCaseActionPermissions20260928120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = ${appendMissing('default_permissions')}
      WHERE name = 'DIRECTOR' OR name ~ '^S[0-9]+_BASE_DIRECTOR$'
    `,
      [JSON.stringify(DIRECTOR_ADDED)],
    );
    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = ${appendMissing('default_permissions')}
      WHERE name = 'ADMIN' OR name ~ '^A[0-9]+_BASE_ADMIN$' OR name ~ '^S[0-9]+_BASE_ADMIN$'
    `,
      [JSON.stringify(ADMIN_ADDED)],
    );
    await queryRunner.query(
      `
      UPDATE users account
      SET permissions = role.default_permissions
      FROM roles role
      WHERE role.name = account.role
        AND account.username <> $1
    `,
      [SANDBOX_USERNAME],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET permissions = ${appendMissing("COALESCE(permissions, '[]'::jsonb)")}
      WHERE username = $2
    `,
      [JSON.stringify(NEW_PERMISSIONS), SANDBOX_USERNAME],
    );
    await queryRunner.query(`
      UPDATE case_review_actions
      SET required_permission_code = 'case:review'
      WHERE required_permission_code = 'dashboard'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE case_review_actions
      SET required_permission_code = 'dashboard'
      WHERE required_permission_code = 'case:review'
    `);
    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = default_permissions - $1::text[]
      WHERE default_permissions ?| $1::text[]
    `,
      [NEW_PERMISSIONS],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET permissions = permissions - $1::text[]
      WHERE permissions ?| $1::text[]
    `,
      [NEW_PERMISSIONS],
    );
  }
}
