import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Revision 0 preserves existing agency sessions until the code is rotated. */
export class AddReferralAccessCodeRevision20261010100000 implements MigrationInterface {
  name = 'AddReferralAccessCodeRevision20261010100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_links
        ADD COLUMN access_code_revision INTEGER NOT NULL DEFAULT 0,
        ADD CONSTRAINT chk_referral_access_code_revision CHECK (access_code_revision >= 0)
    `);
  }

  /** Downgrade application code only after old agency sessions have expired. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_links
        DROP CONSTRAINT chk_referral_access_code_revision,
        DROP COLUMN access_code_revision
    `);
  }
}
