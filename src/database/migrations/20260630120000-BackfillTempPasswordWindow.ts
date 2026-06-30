import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTempPasswordWindow20260630120000 implements MigrationInterface {
  name = 'BackfillTempPasswordWindow20260630120000';

  // Accounts created with a temporary password before the expiry feature
  // (migration 20260628120000) have a NULL window, so the admin table shows no
  // start/end date and login never enforces expiry. This applies to every role
  // created via the admin "create user" / bulk-generate flows, not just students.
  // Give each still-unused account a fresh 7-day window from migration time,
  // matching the TTL used by create / bulk generate / reissue (TEMP_PASSWORD_TTL_DAYS).
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
      SET temporary_password_issued_at = now(),
          temporary_password_expires_at = now() + INTERVAL '7 days'
      WHERE status = 'ACTIVE'
        AND must_change_password = TRUE
        AND temporary_password_expires_at IS NULL
    `);
  }

  // Best-effort reverse: clear the window for still-unused accounts, restoring
  // the pre-backfill state where temp passwords carried no expiry.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
      SET temporary_password_issued_at = NULL,
          temporary_password_expires_at = NULL
      WHERE status = 'ACTIVE'
        AND must_change_password = TRUE
    `);
  }
}
