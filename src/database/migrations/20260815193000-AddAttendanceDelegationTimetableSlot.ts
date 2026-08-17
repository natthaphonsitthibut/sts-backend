import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A subject may meet more than once on the same day. Persisting the concrete
 * timetable slot makes each delegated period independently selectable while a
 * homeroom delegation continues to have no slot.
 */
export class AddAttendanceDelegationTimetableSlot20260815193000 implements MigrationInterface {
  name = 'AddAttendanceDelegationTimetableSlot20260815193000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_attendance_assignments
        ADD COLUMN timetable_slot_id BIGINT;
      ALTER TABLE teacher_access_attendance_assignments
        ADD CONSTRAINT fk_teacher_access_attendance_assignments_timetable_slot
        FOREIGN KEY (timetable_slot_id) REFERENCES timetable_slots(id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
      CREATE INDEX idx_teacher_access_attendance_assignment_slot
        ON teacher_access_attendance_assignments (assignment_id, attendance_date, timetable_slot_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_teacher_access_attendance_assignment_slot;
      ALTER TABLE teacher_access_attendance_assignments
        DROP CONSTRAINT IF EXISTS fk_teacher_access_attendance_assignments_timetable_slot;
      ALTER TABLE teacher_access_attendance_assignments
        DROP COLUMN IF EXISTS timetable_slot_id;
    `);
  }
}
