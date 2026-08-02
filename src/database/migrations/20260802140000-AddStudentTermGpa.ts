import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the GPA for one enrollment term separately from GPAX_Onec, which is
 * the cumulative average across terms. Nullable by design: upstream rosters
 * may arrive before grades are finalized, and production data must never be
 * filled with a synthetic default.
 */
export class AddStudentTermGpa20260802140000 implements MigrationInterface {
  name = 'AddStudentTermGpa20260802140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD COLUMN IF NOT EXISTS term_gpa NUMERIC(4,2)
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        DROP CONSTRAINT IF EXISTS chk_student_term_term_gpa
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD CONSTRAINT chk_student_term_term_gpa
        CHECK (term_gpa IS NULL OR term_gpa BETWEEN 0.00 AND 4.00)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term
        DROP CONSTRAINT IF EXISTS chk_student_term_term_gpa,
        DROP COLUMN IF EXISTS term_gpa
    `);
  }
}
