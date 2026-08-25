import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropTaskLinkOtpColumns20260827312000 implements MigrationInterface {
  name = 'DropTaskLinkOtpColumns20260827312000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_locked_until`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_attempts`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_verified`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_expires_at`);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS otp_code`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links ADD COLUMN otp_code TEXT`);
    await queryRunner.query(`ALTER TABLE task_links ADD COLUMN otp_expires_at TIMESTAMPTZ`);
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN otp_verified INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE task_links ADD COLUMN otp_locked_until TIMESTAMPTZ`);
  }
}
