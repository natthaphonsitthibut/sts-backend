import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserves the reviewer's proposed assistance plan separately from the assigned task. */
export class AddReviewAssistanceMeasures20260827312600 implements MigrationInterface {
  name = 'AddReviewAssistanceMeasures20260827312600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_reviews
        ADD COLUMN proposed_assistance_measure_detail TEXT NULL,
        ADD CONSTRAINT chk_case_reviews_assistance_detail CHECK (
          proposed_assistance_measure_detail IS NULL OR review_action = 'ASSIST'
        )
    `);
    await queryRunner.query(`
      CREATE TABLE case_review_assistance_measures (
        case_review_id UUID NOT NULL,
        assistance_measure_code VARCHAR(40) NOT NULL,
        CONSTRAINT pk_case_review_assistance_measures
          PRIMARY KEY (case_review_id, assistance_measure_code),
        CONSTRAINT fk_case_review_assistance_measures_review
          FOREIGN KEY (case_review_id) REFERENCES case_reviews(id)
          ON UPDATE CASCADE ON DELETE CASCADE,
        CONSTRAINT fk_case_review_assistance_measures_measure
          FOREIGN KEY (assistance_measure_code) REFERENCES assistance_measure_options(code)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_review_assistance_measures_measure
        ON case_review_assistance_measures (assistance_measure_code)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_review_assistance_measures_measure`);
    await queryRunner.query(`DROP TABLE IF EXISTS case_review_assistance_measures`);
    await queryRunner.query(`
      ALTER TABLE case_reviews
        DROP CONSTRAINT IF EXISTS chk_case_reviews_assistance_detail,
        DROP COLUMN IF EXISTS proposed_assistance_measure_detail
    `);
  }
}
