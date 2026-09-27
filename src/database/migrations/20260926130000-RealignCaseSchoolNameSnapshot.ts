import type { MigrationInterface, QueryRunner } from 'typeorm';

const BACKUP_TABLE = 'case_school_name_realign_backup_20260926';

/**
 * Brings `cases.student_school` (a text snapshot taken when the case opened)
 * back in line with the school the case belongs to (`cases.school_id`).
 *
 * 20260827313400-RelocateBuraphaSchool renamed school 10010004 without
 * touching this snapshot, so its cases still carried the former name: the case
 * page showed a different school from the list, and grade/room filters that
 * match the snapshot against the school name silently dropped those cases.
 * Only rows whose snapshot differs from their own school's current name are
 * changed; the previous text is kept for `down()`.
 */
export class RealignCaseSchoolNameSnapshot20260926130000 implements MigrationInterface {
  name = 'RealignCaseSchoolNameSnapshot20260926130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        case_id INTEGER PRIMARY KEY
          REFERENCES cases(id) ON UPDATE CASCADE ON DELETE CASCADE,
        student_school TEXT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (case_id, student_school)
      SELECT c.id, c.student_school
      FROM cases c
      JOIN schools school ON school.id = c.school_id
      WHERE c.student_school IS DISTINCT FROM school.name
      ON CONFLICT (case_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE cases c
      SET student_school = school.name
      FROM schools school
      WHERE school.id = c.school_id
        AND c.student_school IS DISTINCT FROM school.name
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cases c
      SET student_school = backup.student_school
      FROM ${BACKUP_TABLE} backup
      WHERE backup.case_id = c.id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
  }
}
