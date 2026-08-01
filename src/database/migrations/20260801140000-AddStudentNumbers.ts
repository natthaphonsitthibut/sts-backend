import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the school-owned student number used on classroom rosters. This is
 * intentionally separate from student_uuid (internal enrollment identity) and
 * PersonID_Onec (sensitive national/person identifier).
 *
 * Schools own these codes and supply them through import — the app never
 * generates or rewrites one. Existing enrollments therefore remain null until
 * the school provides a value.
 */
export class AddStudentNumbers20260801140000 implements MigrationInterface {
  name = 'AddStudentNumbers20260801140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term
      ADD COLUMN student_number VARCHAR(50)
    `);

    await queryRunner.query(`
      ALTER TABLE student_term
      ADD CONSTRAINT chk_student_term_student_number_format
      CHECK (
        student_number IS NULL
        OR (
          student_number = BTRIM(student_number)
          AND CHAR_LENGTH(student_number) BETWEEN 1 AND 50
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_student_term_school_term_student_number
      ON student_term (
        "SchoolID_Onec",
        "AcademicYear_Onec",
        "Semester_Onec",
        student_number
      )
      WHERE student_number IS NOT NULL AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_student_term_school_term_student_number`);
    await queryRunner.query(`
      ALTER TABLE student_term
      DROP CONSTRAINT IF EXISTS chk_student_term_student_number_format
    `);
    await queryRunner.query(`ALTER TABLE student_term DROP COLUMN IF EXISTS student_number`);
  }
}
