import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * วันและเวลาที่ดำเนินการ (owner, 2026-10-15): the agency reports when it acted
 * down to the minute, not only the day. `action_date DATE` becomes
 * `action_at TIMESTAMPTZ`; existing reports keep their day, at 10:00 Bangkok.
 *
 * Still nullable, as before: a result the school records on the agency's behalf
 * has no action time. A report filed through the agency's link must carry one
 * (the reporter check), and no report may be dated after it was recorded
 * (allowing the same five-minute clock skew the API allows).
 */
export class ReplaceReferralResultActionDateWithTime20261015170000 implements MigrationInterface {
  name = 'ReplaceReferralResultActionDateWithTime20261015170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_referral_results ADD COLUMN action_at TIMESTAMPTZ
    `);
    // Existing reports had no time (owner: any time will do): their day at
    // 10:00 Bangkok, never after the report was recorded; a result the school
    // recorded without a day takes its recording time.
    await queryRunner.query(`
      UPDATE case_referral_results
      SET action_at = CASE
        WHEN action_date IS NULL THEN recorded_at
        ELSE LEAST(
          ((action_date + time '10:00')::timestamp AT TIME ZONE 'Asia/Bangkok'),
          recorded_at
        )
      END
    `);
    await queryRunner.query(`
      ALTER TABLE case_referral_results DROP CONSTRAINT chk_case_referral_results_reporter
    `);
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        ADD CONSTRAINT chk_case_referral_results_reporter CHECK (
          case_referral_link_id IS NULL
          OR (
            reporter_identity_provider_code IS NOT NULL
            AND reporter_provider_subject IS NOT NULL
            AND length(btrim(reporter_provider_subject)) > 0
            AND reporter_name IS NOT NULL
            AND length(btrim(reporter_name)) > 0
            AND action_at IS NOT NULL
          )
        ),
        ADD CONSTRAINT chk_case_referral_results_action_at CHECK (
          action_at IS NULL OR action_at <= recorded_at + interval '5 minutes'
        )
    `);
    await queryRunner.query(`ALTER TABLE case_referral_results DROP COLUMN action_date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE case_referral_results ADD COLUMN action_date DATE`);
    await queryRunner.query(`
      UPDATE case_referral_results
      SET action_date = (action_at AT TIME ZONE 'Asia/Bangkok')::date
      WHERE action_at IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        DROP CONSTRAINT chk_case_referral_results_action_at,
        DROP CONSTRAINT chk_case_referral_results_reporter
    `);
    await queryRunner.query(`
      ALTER TABLE case_referral_results
        ADD CONSTRAINT chk_case_referral_results_reporter CHECK (
          case_referral_link_id IS NULL
          OR (
            reporter_identity_provider_code IS NOT NULL
            AND reporter_provider_subject IS NOT NULL
            AND length(btrim(reporter_provider_subject)) > 0
            AND reporter_name IS NOT NULL
            AND length(btrim(reporter_name)) > 0
            AND action_date IS NOT NULL
          )
        )
    `);
    await queryRunner.query(`ALTER TABLE case_referral_results DROP COLUMN action_at`);
  }
}
