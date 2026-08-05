import type { MigrationInterface, QueryRunner } from 'typeorm';

const OUTCOME_VALUES = [
  'RETURNED_TO_SCHOOL',
  'TRANSFERRED_SCHOOL',
  'ILLNESS',
  'WORKING',
  'UNREACHABLE',
  'REFERRED_EXTERNAL',
  'OTHER',
];

export class AddCaseReviewResolutionOutcome20260626120000 implements MigrationInterface {
  name = 'AddCaseReviewResolutionOutcome20260626120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE case_reviews
      ADD COLUMN IF NOT EXISTS resolution_outcome varchar(40)
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews
      DROP CONSTRAINT IF EXISTS chk_case_reviews_resolution_outcome
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews
      ADD CONSTRAINT chk_case_reviews_resolution_outcome
      CHECK (
        resolution_outcome IS NULL
        OR resolution_outcome IN (${OUTCOME_VALUES.map((value) => `'${value}'`).join(', ')})
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_case_reviews_resolution_outcome
      ON case_reviews (resolution_outcome)
      WHERE resolution_outcome IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_case_reviews_resolution_outcome`);
    await queryRunner.query(`
      ALTER TABLE case_reviews
      DROP CONSTRAINT IF EXISTS chk_case_reviews_resolution_outcome
    `);
    await queryRunner.query(`
      ALTER TABLE case_reviews
      DROP COLUMN IF EXISTS resolution_outcome
    `);
  }
}
