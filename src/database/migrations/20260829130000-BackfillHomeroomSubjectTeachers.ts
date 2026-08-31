import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives the homeroom subject the teacher the school already named for it.
 *
 * `classroom_homeroom_teachers` is a recorded fact — someone chose that teacher
 * for that classroom — so copying it into the new assignment table states
 * nothing new. Every other subject is left empty on purpose: nothing in the
 * database says who teaches ม.2/1 คณิตศาสตร์, and a migration inventing an
 * answer would put assignments in front of users that look authoritative and
 * are not. Those come from the curriculum screen, one deliberate choice at a
 * time.
 *
 * Matching is by subject code rather than the Thai label so a school that has
 * renamed the subject still backfills.
 */
export class BackfillHomeroomSubjectTeachers20260829130000 implements MigrationInterface {
  name = 'BackfillHomeroomSubjectTeachers20260829130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO classroom_subject_teachers (
        school_id, classroom_id, classroom_subject_id, teacher_membership_id
      )
      SELECT
        offering.school_id,
        offering.classroom_id,
        offering.id,
        homeroom.teacher_membership_id
      FROM classroom_subjects offering
      JOIN school_subjects school_subject
        ON school_subject.id = offering.school_subject_id
       AND school_subject.deleted_at IS NULL
      JOIN subjects subject
        ON subject.id = school_subject.subject_id
       AND subject.code = 'HOMEROOM101'
      JOIN classroom_homeroom_teachers homeroom
        ON homeroom.classroom_id = offering.classroom_id
       AND homeroom.school_id = offering.school_id
      WHERE offering.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the rows this migration could have created: a homeroom assignment
    // someone has since edited by hand keeps whichever teacher they chose.
    await queryRunner.query(`
      DELETE FROM classroom_subject_teachers assignment
      USING classroom_subjects offering
      JOIN school_subjects school_subject
        ON school_subject.id = offering.school_subject_id
      JOIN subjects subject
        ON subject.id = school_subject.subject_id
       AND subject.code = 'HOMEROOM101'
      JOIN classroom_homeroom_teachers homeroom
        ON homeroom.classroom_id = offering.classroom_id
       AND homeroom.school_id = offering.school_id
      WHERE assignment.classroom_subject_id = offering.id
        AND assignment.teacher_membership_id = homeroom.teacher_membership_id
    `);
  }
}
