import type { MigrationInterface, QueryRunner } from 'typeorm';

const BACKUP_TABLE = 'case_student_name_realign_backup_20260926';

/**
 * Brings the student-name snapshot on `cases` (`student_name`,
 * `student_first_name`, `student_last_name`) back in line with the student's
 * enrollment row. A student edited after the case opened left the case under
 * the old name: the case page disagreed with the student record, and the
 * grade/room filters that match `cases.student_name` against the enrollment
 * name silently dropped the case. Only rows whose snapshot differs are changed;
 * the previous values are kept for `down()`.
 */
export class RealignCaseStudentNameSnapshot20260926150000 implements MigrationInterface {
  name = 'RealignCaseStudentNameSnapshot20260926150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        case_id INTEGER PRIMARY KEY
          REFERENCES cases(id) ON UPDATE CASCADE ON DELETE CASCADE,
        student_name TEXT NULL,
        student_first_name TEXT NULL,
        student_last_name TEXT NULL
      )
    `);
    await queryRunner.query(`
      CREATE TEMP TABLE case_student_name_drift ON COMMIT DROP AS
      SELECT c.id AS case_id,
        NULLIF(TRIM(student."FirstName_Onec"), '') AS first_name,
        NULLIF(TRIM(student."LastName_Onec"), '') AS last_name,
        TRIM(CONCAT_WS(' ', student."FirstName_Onec", student."LastName_Onec")) AS full_name
      FROM cases c
      JOIN student_term student ON student.student_uuid = c.student_uuid
      WHERE NULLIF(TRIM(CONCAT_WS(' ', student."FirstName_Onec", student."LastName_Onec")), '') IS NOT NULL
        AND LOWER(TRIM(c.student_name)) IS DISTINCT FROM
            LOWER(TRIM(CONCAT_WS(' ', student."FirstName_Onec", student."LastName_Onec")))
    `);
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (case_id, student_name, student_first_name, student_last_name)
      SELECT c.id, c.student_name, c.student_first_name, c.student_last_name
      FROM cases c
      JOIN case_student_name_drift drift ON drift.case_id = c.id
      ON CONFLICT (case_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE cases c
      SET student_name = drift.full_name,
          student_first_name = drift.first_name,
          student_last_name = drift.last_name
      FROM case_student_name_drift drift
      WHERE drift.case_id = c.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cases c
      SET student_name = backup.student_name,
          student_first_name = backup.student_first_name,
          student_last_name = backup.student_last_name
      FROM ${BACKUP_TABLE} backup
      WHERE backup.case_id = c.id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  }
}
