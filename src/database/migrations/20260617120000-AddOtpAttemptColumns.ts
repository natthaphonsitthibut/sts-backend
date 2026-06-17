import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H1 brute-force defense — durable OTP attempt lockout for magic links.
 *
 * `task_links` already holds the OTP (`otp_code`/`otp_expires_at`); a 6-digit
 * code with a 10-minute window is trivially brute-forceable without a per-link
 * attempt cap. These two additive columns track failed guesses and the lockout
 * window directly on the row, so the limit survives process restarts and is
 * shared across instances (an in-memory counter would not). Additive and
 * reversible.
 */
export class AddOtpAttemptColumns20260617120000 implements MigrationInterface {
  name = 'AddOtpAttemptColumns20260617120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN IF NOT EXISTS otp_locked_until TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_locked_until`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_attempts`);
  }
}
