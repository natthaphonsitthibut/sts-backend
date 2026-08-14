import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `timetable_slots.teacher_user_id` / `.teacher_membership_id` are legacy
 * columns superseded by `timetable_slot_teachers` (the many-teacher join
 * table). `listForTeacher()`'s query only ignores them via a `NOT EXISTS`
 * guard when a real `timetable_slot_teachers` row exists — but nothing ever
 * cleared them when a slot got reassigned through the modern
 * `teacherMembershipIds` update path (fixed separately in
 * `timetable.service.ts`/`timetable.repository.ts`), so a slot reassigned to
 * a new teacher kept pointing at the old one via these columns. Combined with
 * a `listForTeacher()` WHERE-clause bug that checked `teacher_user_id`
 * unconditionally instead of behind that same guard (also fixed), the old
 * teacher's schedule query resurfaced the slot alongside their real one —
 * showing as a phantom double-booking at the same day/period.
 *
 * This backfills the data: for every slot that already has a
 * `timetable_slot_teachers` assignment, the legacy columns are stale and get
 * cleared. Old values are preserved in a backup table for `down()`.
 */
export class ClearStaleTimetableSlotLegacyTeacher20260814130000 implements MigrationInterface {
  name = 'ClearStaleTimetableSlotLegacyTeacher20260814130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS timetable_slot_legacy_teacher_backup (
        timetable_slot_id BIGINT PRIMARY KEY REFERENCES timetable_slots(id) ON DELETE CASCADE,
        previous_teacher_user_id INTEGER NULL,
        previous_teacher_membership_id BIGINT NULL,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO timetable_slot_legacy_teacher_backup
        (timetable_slot_id, previous_teacher_user_id, previous_teacher_membership_id)
      SELECT ts.id, ts.teacher_user_id, ts.teacher_membership_id
      FROM timetable_slots ts
      WHERE ts.deleted_at IS NULL
        AND (ts.teacher_user_id IS NOT NULL OR ts.teacher_membership_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM timetable_slot_teachers tst WHERE tst.timetable_slot_id = ts.id
        )
      ON CONFLICT (timetable_slot_id) DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE timetable_slots ts
      SET teacher_user_id = NULL, teacher_membership_id = NULL
      FROM timetable_slot_legacy_teacher_backup backup
      WHERE backup.timetable_slot_id = ts.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE timetable_slots ts
      SET teacher_user_id = backup.previous_teacher_user_id,
          teacher_membership_id = backup.previous_teacher_membership_id
      FROM timetable_slot_legacy_teacher_backup backup
      WHERE backup.timetable_slot_id = ts.id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS timetable_slot_legacy_teacher_backup`);
  }
}
