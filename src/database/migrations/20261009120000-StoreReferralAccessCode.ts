import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Existing hashes cannot be reversed; old links keep their original code. */
export class StoreReferralAccessCode20261009120000 implements MigrationInterface {
  name = 'StoreReferralAccessCode20261009120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_links
        ADD COLUMN access_code_encrypted TEXT NULL,
        ADD CONSTRAINT chk_referral_access_code_encrypted
          CHECK (access_code_encrypted IS NULL OR length(btrim(access_code_encrypted)) > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_links
        DROP CONSTRAINT chk_referral_access_code_encrypted,
        DROP COLUMN access_code_encrypted
    `);
  }
}
