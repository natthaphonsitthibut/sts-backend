import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds "ลา" (leave) as a recordable attendance status. `attendance."AttendanceStatus"`
 * has an FK to this catalog, so the code has to exist here before any check-in
 * flow can persist it.
 */
export class AddLeaveAttendanceStatus20260801190000 implements MigrationInterface {
  name = 'AddLeaveAttendanceStatus20260801190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO attendance_record_statuses (
        code, internal_code, short_label_th, label_th, badge_variant, sort_order
      ) VALUES
        (4, 'P_LEAVE', 'ลา', 'ลากิจ/ลาป่วย', 'secondary', 40)
      ON CONFLICT (code) DO NOTHING
    `);

    await queryRunner.query(`
      DO $leave_status$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM attendance_record_statuses
          WHERE code = 4
            AND internal_code = 'P_LEAVE'
            AND short_label_th = 'ลา'
            AND label_th = 'ลากิจ/ลาป่วย'
        ) THEN
          RAISE EXCEPTION
            'Attendance status code 4 exists with metadata that conflicts with P_LEAVE';
        END IF;
      END
      $leave_status$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $leave_status$
      BEGIN
        IF EXISTS (SELECT 1 FROM attendance WHERE "AttendanceStatus" = 4) THEN
          RAISE EXCEPTION
            'Cannot remove attendance status P_LEAVE while attendance records use code 4';
        END IF;

        DELETE FROM attendance_record_statuses
        WHERE code = 4 AND internal_code = 'P_LEAVE';
      END
      $leave_status$
    `);
  }
}
