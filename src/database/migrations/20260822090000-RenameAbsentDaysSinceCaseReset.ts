import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `student_risk_profiles.absent_days` never meant "days absent".
 *
 * It is the count that restarts every time a case is closed — the boundary is
 * `case_completion_baselines.reset_after_date` — while the untouched
 * term-to-date figure lives next to it in `term_absent_days`. Two columns whose
 * names differ only by a prefix, where the shorter one is the *narrower* number,
 * is a trap: reading `absent_days` and assuming it is the total is the obvious
 * mistake, and the value is what decides whether a student is flagged HIGH.
 *
 * The new name borrows the word the schema already uses for that boundary
 * (`reset_after_date`), so the pair reads as what it is:
 *
 *   term_absent_days              — whole term
 *   absent_days_since_case_reset  — since the last case was closed
 */
export class RenameAbsentDaysSinceCaseReset20260822090000 implements MigrationInterface {
  name = 'RenameAbsentDaysSinceCaseReset20260822090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles RENAME COLUMN absent_days TO absent_days_since_case_reset
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles RENAME COLUMN absent_days_since_case_reset TO absent_days
    `);
  }
}
