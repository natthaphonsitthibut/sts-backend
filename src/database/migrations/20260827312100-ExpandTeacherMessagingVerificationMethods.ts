import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandTeacherMessagingVerificationMethods20260827312100 implements MigrationInterface {
  name = 'ExpandTeacherMessagingVerificationMethods20260827312100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE teacher_messaging_accounts
       DROP CONSTRAINT IF EXISTS chk_teacher_messaging_accounts_verified_via`,
    );
    await queryRunner.query(
      `ALTER TABLE teacher_messaging_accounts ALTER COLUMN verified_via DROP DEFAULT`,
    );
    await queryRunner.query(
      `DELETE FROM teacher_messaging_accounts
       WHERE verified_via = 'EMAIL_OTP'`,
    );
    await queryRunner.query(
      `ALTER TABLE teacher_messaging_accounts
       ADD CONSTRAINT chk_teacher_messaging_accounts_verified_via
       CHECK (verified_via IN ('GOOGLE', 'ARAID'))`,
    );
  }

  public async down(): Promise<void> {
    await Promise.reject(
      new Error(
        'Cannot restore hard-deleted EMAIL_OTP teacher messaging accounts; restore a pre-migration database backup instead.',
      ),
    );
  }
}
