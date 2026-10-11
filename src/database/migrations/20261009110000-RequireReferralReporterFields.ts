import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Tighten the existing CHECK: PostgreSQL accepts UNKNOWN, so require non-null fields explicitly. */
export class RequireReferralReporterFields20261009110000 implements MigrationInterface {
  name = 'RequireReferralReporterFields20261009110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        DROP CONSTRAINT chk_case_referral_results_reporter,
        ADD CONSTRAINT chk_case_referral_results_reporter CHECK (
          case_referral_link_id IS NULL OR (
            reporter_identity_provider_code IS NOT NULL
            AND reporter_provider_subject IS NOT NULL
            AND length(btrim(reporter_provider_subject)) > 0
            AND reporter_name IS NOT NULL
            AND length(btrim(reporter_name)) > 0
            AND action_date IS NOT NULL
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        DROP CONSTRAINT chk_case_referral_results_reporter,
        ADD CONSTRAINT chk_case_referral_results_reporter CHECK (
          case_referral_link_id IS NULL OR (
            reporter_identity_provider_code IS NOT NULL
            AND length(btrim(reporter_provider_subject)) > 0
            AND length(btrim(reporter_name)) > 0
          )
        )
    `);
  }
}
