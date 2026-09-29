import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A student-term import row whose student number already belongs to another
 * student in that school and term used to reach the write and fail on
 * `uq_student_term_school_term_student_number`, turning the whole import into a
 * 500 even though the preview had called the row ready. The row is now held for
 * review instead, under its own reason.
 */
export class AddStudentNumberConflictQuarantineReason20260929110000 implements MigrationInterface {
  name = 'AddStudentNumberConflictQuarantineReason20260929110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
      VALUES ('STUDENT_NUMBER_CONFLICT', 'รหัสนักเรียนซ้ำกับนักเรียนคนอื่นในภาคเรียนนี้', 55)
      ON CONFLICT (code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          sort_order = EXCLUDED.sort_order
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows already held under this reason keep it (the FK refuses the delete),
    // rather than silently losing why they were held.
    await queryRunner.query(`
      DELETE FROM student_import_quarantine_reason_codes
      WHERE code = 'STUDENT_NUMBER_CONFLICT'
        AND NOT EXISTS (
          SELECT 1 FROM student_import_quarantine_rows
          WHERE reason_code = 'STUDENT_NUMBER_CONFLICT'
        )
    `);
  }
}
