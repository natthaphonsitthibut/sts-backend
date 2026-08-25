import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persists the category selected in a follow-up report independently from its
 * optional detailed reason. Existing rows are backfilled through the reason
 * catalog; reports that never stored a reason remain null because their former
 * category cannot be reconstructed safely.
 */
export class PreserveFollowUpAbsenceCategory20260827313300 implements MigrationInterface {
  name = 'PreserveFollowUpAbsenceCategory20260827313300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
      ADD COLUMN absence_reason_category_code VARCHAR(40) NULL
    `);
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET absence_reason_category_code = reason.category_code
      FROM absence_reasons reason
      WHERE reason.code = submission.absence_reason_code
        AND submission.absence_reason_category_code IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      ADD CONSTRAINT fk_task_submissions_absence_reason_category
      FOREIGN KEY (absence_reason_category_code)
      REFERENCES absence_reason_categories(code)
      ON UPDATE CASCADE ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
      DROP CONSTRAINT IF EXISTS fk_task_submissions_absence_reason_category
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
      DROP COLUMN IF EXISTS absence_reason_category_code
    `);
  }
}
