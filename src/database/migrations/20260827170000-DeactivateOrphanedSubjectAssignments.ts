import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `classroom_teacher_assignments` (SUBJECT kind) is meant to mirror
 * `curriculum_subject_teachers` via `replaceTeacherCoverage`/`syncSubjectAssignments` —
 * removing a teacher from a subject's curriculum coverage deactivates their
 * matching assignment row too. A bulk removal on 2026-08-13 (330
 * `curriculum_subject_teachers` rows soft-deleted in one minute, `deleted_by`
 * NULL — a direct write outside that sync path, confirmed as intentional by
 * the owner) left the assignment side untouched: 313 assignment rows stayed
 * ACTIVE with no matching active curriculum coverage row, so the timetable
 * teacher picker kept offering teachers who had already been removed from a
 * subject. A further 16 rows (very old, low ids) never had a curriculum
 * offering at all — pre-dating the curriculum feature — and are deactivated
 * the same way since nothing in the current data can say what they should be.
 *
 * This deactivates (not deletes) every such orphan, same convention as
 * `syncSubjectAssignments`'s own removal path, and backs up exactly the rows
 * touched so `down()` can restore them precisely.
 */
export class DeactivateOrphanedSubjectAssignments20260827170000 implements MigrationInterface {
  name = 'DeactivateOrphanedSubjectAssignments20260827170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE orphaned_subject_assignment_deactivation_20260827_backup (
        assignment_id BIGINT PRIMARY KEY
          REFERENCES classroom_teacher_assignments(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      WITH orphans AS (
        SELECT cta.id
        FROM classroom_teacher_assignments cta
        WHERE cta.assignment_kind = 'SUBJECT'
          AND cta.assignment_status = 'ACTIVE'
          AND cta.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM curriculum_subject_teachers cst
            JOIN curriculum_subjects cs ON cs.id = cst.curriculum_subject_id
            WHERE cst.teacher_membership_id = cta.teacher_membership_id
              AND cst.classroom_id = cta.classroom_id
              AND cs.subject_id = cta.subject_id
              AND cst.deleted_at IS NULL
          )
      ),
      backed_up AS (
        INSERT INTO orphaned_subject_assignment_deactivation_20260827_backup (assignment_id)
        SELECT id FROM orphans
        RETURNING assignment_id
      )
      UPDATE classroom_teacher_assignments
      SET assignment_status = 'INACTIVE', updated_at = now()
      WHERE id IN (SELECT assignment_id FROM backed_up)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE classroom_teacher_assignments assignment
      SET assignment_status = 'ACTIVE', updated_at = now()
      FROM orphaned_subject_assignment_deactivation_20260827_backup backup
      WHERE assignment.id = backup.assignment_id
    `);
    await queryRunner.query(`DROP TABLE orphaned_subject_assignment_deactivation_20260827_backup`);
  }
}
