import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lookup tables had drifted into four competing suffixes for the same idea.
 * This settles the two families that actually collide and fixes two names that
 * no longer describe what the rows mean:
 *
 * - `<domain>_<concept>_options` = the answers a form offers. `assistance_measures`
 *   and `home_visit_assessment_options` join `guardian_type_options`,
 *   `parental_status_options` and `residence_environment_options` there.
 * - `<domain>_statuses` = the state a record sits in over time.
 *   `student_import_quarantine_resolution_states` was the only `_states` holdout
 *   among nine `_statuses`.
 *
 * `home_visit_assessment_options` is also renamed for meaning, not just shape:
 * the field is labelled `ผลการติดตาม` and is filled for every follow-up round,
 * not only a home visit, so `follow_up_result_options` matches the flow.
 *
 * Renames keep the rows, foreign keys and indexes, so no data moves.
 */
export class NormalizeLookupTableNames20260817120000 implements MigrationInterface {
  name = 'NormalizeLookupTableNames20260817120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assistance_measures RENAME TO assistance_measure_options`);
    await queryRunner.query(`
      ALTER TABLE assistance_measure_options
        RENAME CONSTRAINT chk_assistance_measures_label TO chk_assistance_measure_options_label
    `);
    await queryRunner.query(`
      ALTER TABLE assistance_measure_options
        RENAME CONSTRAINT chk_assistance_measures_sort_order
        TO chk_assistance_measure_options_sort_order
    `);
    await queryRunner.query(`
      ALTER TRIGGER trg_assistance_measures_set_updated_at ON assistance_measure_options
        RENAME TO trg_assistance_measure_options_set_updated_at
    `);

    await queryRunner.query(
      `ALTER TABLE home_visit_assessment_options RENAME TO follow_up_result_options`,
    );

    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_resolution_states
        RENAME TO student_import_quarantine_resolution_statuses
    `);

    // The risk ladder collapsed to NORMAL/WATCH/HIGH in
    // 20260804120000-CollapseRiskTiersToThreeLevels, but this review table kept
    // accepting the retired LOW/MEDIUM tiers.
    await queryRunner.query(`
      ALTER TABLE student_observation_risk_reviews
        DROP CONSTRAINT IF EXISTS chk_observation_risk_reviews_calculated_risk
    `);
    await queryRunner.query(`
      UPDATE student_observation_risk_reviews
      SET calculated_attendance_risk = 'NORMAL'
      WHERE calculated_attendance_risk IN ('LOW', 'MEDIUM')
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_risk_reviews
        ADD CONSTRAINT chk_observation_risk_reviews_calculated_risk
        CHECK (calculated_attendance_risk IN ('UNKNOWN', 'NORMAL', 'WATCH', 'HIGH'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_observation_risk_reviews
        DROP CONSTRAINT IF EXISTS chk_observation_risk_reviews_calculated_risk
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_risk_reviews
        ADD CONSTRAINT chk_observation_risk_reviews_calculated_risk
        CHECK (calculated_attendance_risk IN ('UNKNOWN', 'NORMAL', 'WATCH', 'LOW', 'MEDIUM', 'HIGH'))
    `);
    await queryRunner.query(`
      ALTER TABLE student_import_quarantine_resolution_statuses
        RENAME TO student_import_quarantine_resolution_states
    `);
    await queryRunner.query(
      `ALTER TABLE follow_up_result_options RENAME TO home_visit_assessment_options`,
    );
    await queryRunner.query(`
      ALTER TRIGGER trg_assistance_measure_options_set_updated_at ON assistance_measure_options
        RENAME TO trg_assistance_measures_set_updated_at
    `);
    await queryRunner.query(`
      ALTER TABLE assistance_measure_options
        RENAME CONSTRAINT chk_assistance_measure_options_sort_order
        TO chk_assistance_measures_sort_order
    `);
    await queryRunner.query(`
      ALTER TABLE assistance_measure_options
        RENAME CONSTRAINT chk_assistance_measure_options_label TO chk_assistance_measures_label
    `);
    await queryRunner.query(`ALTER TABLE assistance_measure_options RENAME TO assistance_measures`);
  }
}
