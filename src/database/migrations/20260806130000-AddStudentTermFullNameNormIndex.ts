import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * /cases list query (TaskRepository.listCasesWithActiveLinks) matches each case
 * to a student by normalized full name with no supporting index, forcing a
 * sequential scan of student_term on every request (3x: count, list, status
 * counts). CONCAT_WS is only STABLE, not IMMUTABLE, so Postgres refuses to
 * index it directly — norm_full_name wraps the same expression over fixed
 * text columns (genuinely deterministic here) so it can be marked IMMUTABLE
 * and indexed. Callers (task.repository.ts) must use norm_full_name(...)
 * instead of the inline expression for the planner to match this index.
 */
export class AddStudentTermFullNameNormIndex20260806130000 implements MigrationInterface {
  name = 'AddStudentTermFullNameNormIndex20260806130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION norm_full_name(first_name text, last_name text)
      RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT LOWER(TRIM(CONCAT_WS(' ', first_name, last_name)))
      $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_term_full_name_norm
      ON student_term (norm_full_name("FirstName_Onec", "LastName_Onec"))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_term_full_name_norm`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS norm_full_name(text, text)`);
  }
}
