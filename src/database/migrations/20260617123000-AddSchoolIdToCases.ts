import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchoolIdToCases20260617123000 implements MigrationInterface {
  name = 'AddSchoolIdToCases20260617123000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
      ADD COLUMN IF NOT EXISTS school_id INTEGER
    `);

    await queryRunner.query(`
      UPDATE cases c
      SET school_id = student_school.school_id
      FROM (
        SELECT DISTINCT ON ("PersonID_Onec")
          "PersonID_Onec" AS student_id,
          "SchoolID_Onec" AS school_id
        FROM student_term
        WHERE "PersonID_Onec" IS NOT NULL
          AND "SchoolID_Onec" IS NOT NULL
        ORDER BY "PersonID_Onec", "AcademicYear_Onec" DESC, "Semester_Onec" DESC
      ) student_school
      WHERE c.school_id IS NULL
        AND c.student_id IS NOT NULL
        AND student_school.student_id = c.student_id
    `);

    await queryRunner.query(`
      UPDATE cases c
      SET school_id = task_school.target_school_id
      FROM (
        SELECT DISTINCT ON (case_id)
          case_id,
          target_school_id
        FROM tasks
        WHERE case_id IS NOT NULL
          AND target_school_id IS NOT NULL
        ORDER BY case_id, created_at DESC, id DESC
      ) task_school
      WHERE c.school_id IS NULL
        AND task_school.case_id = c.id
    `);

    // Last-resort fallback for legacy cases linked to a school only by its name
    // text (no student_id / no task target). Matches on a unique school name.
    await queryRunner.query(`
      UPDATE cases c
      SET school_id = name_school.id
      FROM (
        SELECT name, MIN(id) AS id
        FROM schools
        WHERE name IS NOT NULL AND name <> ''
        GROUP BY name
        HAVING COUNT(*) = 1
      ) name_school
      WHERE c.school_id IS NULL
        AND c.student_school IS NOT NULL
        AND c.student_school <> ''
        AND name_school.name = c.student_school
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_school_id ON cases(school_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_school_id`);
    await queryRunner.query(`
      ALTER TABLE cases
      DROP COLUMN IF EXISTS school_id
    `);
  }
}
