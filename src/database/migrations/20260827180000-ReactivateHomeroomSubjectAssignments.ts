import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `DeactivateOrphanedSubjectAssignments` (20260827170000) swept up 441
 * auto-generated โฮมรูม `SUBJECT` rows as "orphans" because โฮมรูม
 * intentionally has no `curriculum_subject_teachers` coverage —
 * `AddHomeroomFirstPeriod` (the same day, 20260827120000) created them
 * exactly that way on purpose, five hours earlier. The 17:00 migration had
 * no way to know that and deactivated every one of them, so any teacher
 * still holding an ACTIVE `HOMEROOM` assignment lost the paired
 * `SUBJECT`-โฮมรูม row that `assignment_count` and the teacher-access link
 * scope both read — they showed up as having no room or subject this term
 * even though their homeroom assignment was never touched.
 *
 * This reactivates exactly the rows caught by that collision (paired with
 * a still-ACTIVE HOMEROOM row for the same classroom + teacher) and removes
 * them from the original migration's backup table, since they were never a
 * real orphan and its down() should no longer offer to re-deactivate them.
 */
export class ReactivateHomeroomSubjectAssignments20260827180000 implements MigrationInterface {
  name = 'ReactivateHomeroomSubjectAssignments20260827180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM orphaned_subject_assignment_deactivation_20260827_backup backup
      USING classroom_teacher_assignments hr_subject
      WHERE backup.assignment_id = hr_subject.id
        AND hr_subject.assignment_kind = 'SUBJECT'
        AND hr_subject.subject_id = (SELECT id FROM subjects WHERE code = 'HOMEROOM')
        AND EXISTS (
          SELECT 1 FROM classroom_teacher_assignments homeroom
          WHERE homeroom.classroom_id = hr_subject.classroom_id
            AND homeroom.teacher_membership_id = hr_subject.teacher_membership_id
            AND homeroom.assignment_kind = 'HOMEROOM'
            AND homeroom.assignment_status = 'ACTIVE'
            AND homeroom.deleted_at IS NULL
        )
    `);

    await queryRunner.query(`
      UPDATE classroom_teacher_assignments hr_subject
      SET assignment_status = 'ACTIVE', updated_at = now()
      WHERE hr_subject.assignment_kind = 'SUBJECT'
        AND hr_subject.assignment_status = 'INACTIVE'
        AND hr_subject.deleted_at IS NULL
        AND hr_subject.subject_id = (SELECT id FROM subjects WHERE code = 'HOMEROOM')
        AND EXISTS (
          SELECT 1 FROM classroom_teacher_assignments homeroom
          WHERE homeroom.classroom_id = hr_subject.classroom_id
            AND homeroom.teacher_membership_id = hr_subject.teacher_membership_id
            AND homeroom.assignment_kind = 'HOMEROOM'
            AND homeroom.assignment_status = 'ACTIVE'
            AND homeroom.deleted_at IS NULL
        )
    `);
  }

  /**
   * No backup table for this one — nothing here to reconstruct from. Rolling
   * back would mean re-guessing which rows this touched, which is exactly
   * the mistake `DeactivateOrphanedSubjectAssignments` made in the other
   * direction. Same convention as `DropStaleDemoBackupTables`'s no-op down().
   */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
