import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time catch-up for curriculum subject-teacher coverage recorded before
 * `replaceTeacherCoverage` started syncing `classroom_teacher_assignments`.
 *
 * `curriculum_subject_teachers` is the curriculum page's own record of "who
 * teaches this subject" and nothing outside that page reads it; timetable
 * assignment and teacher-link issuance both read `classroom_teacher_assignments`
 * instead. A subject teacher assigned before the sync fix therefore has a
 * coverage row with no matching assignment row, so the timetable screen can't
 * offer them as a candidate and their teacher link is refused as if they
 * taught nothing. This inserts the missing assignment for every such row —
 * additive only, against the same partial unique index the sync path uses.
 */
export class BackfillCurriculumSubjectAssignments20260827130000 implements MigrationInterface {
  name = 'BackfillCurriculumSubjectAssignments20260827130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE curriculum_subject_assignment_backfill_20260827_backup (
        assignment_id BIGINT PRIMARY KEY
          REFERENCES classroom_teacher_assignments(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      WITH inserted AS (
        INSERT INTO classroom_teacher_assignments (
          school_id, classroom_id, teacher_membership_id, subject_id,
          assignment_kind, assignment_status
        )
        SELECT DISTINCT
          cst.school_id, cst.classroom_id, cst.teacher_membership_id, cs.subject_id,
          'SUBJECT', 'ACTIVE'
        FROM curriculum_subject_teachers cst
        JOIN curriculum_subjects cs ON cs.id = cst.curriculum_subject_id AND cs.deleted_at IS NULL
        WHERE cst.deleted_at IS NULL
        ON CONFLICT (classroom_id, teacher_membership_id, subject_id)
          WHERE assignment_kind = 'SUBJECT'
            AND assignment_status = 'ACTIVE'
            AND deleted_at IS NULL
        DO NOTHING
        RETURNING id
      )
      INSERT INTO curriculum_subject_assignment_backfill_20260827_backup (assignment_id)
      SELECT id FROM inserted
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM classroom_teacher_assignments assignment
      USING curriculum_subject_assignment_backfill_20260827_backup backup
      WHERE assignment.id = backup.assignment_id
    `);
    await queryRunner.query(`DROP TABLE curriculum_subject_assignment_backfill_20260827_backup`);
  }
}
