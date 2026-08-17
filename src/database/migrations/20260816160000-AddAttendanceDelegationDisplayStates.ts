import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * สถานะของลิงก์มอบหมายการเช็กชื่อ as a display state instead of a map in the
 * table component. The four states are derived at read time (a grant is revoked,
 * its window has passed, or the round it covers was submitted), so they have no
 * table of their own — `application_display_states` is where the app already
 * keeps exactly this kind of read-time vocabulary, and putting them there lets
 * the label and the badge colour be changed without a release.
 */
export class AddAttendanceDelegationDisplayStates20260816160000 implements MigrationInterface {
  name = 'AddAttendanceDelegationDisplayStates20260816160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order
      ) VALUES
        ('ATTENDANCE_DELEGATION', 'PENDING', 'รอเช็กชื่อ', 'default', 'info', 10),
        ('ATTENDANCE_DELEGATION', 'COMPLETED', 'เสร็จสิ้น', 'success', 'success', 20),
        ('ATTENDANCE_DELEGATION', 'REVOKED', 'ยกเลิก', 'destructive', 'danger', 30),
        ('ATTENDANCE_DELEGATION', 'EXPIRED', 'หมดเวลา', 'warning', 'warning', 40)
      ON CONFLICT (domain_code, code) DO UPDATE
      SET label_th = EXCLUDED.label_th,
          badge_variant = EXCLUDED.badge_variant,
          summary_tone = EXCLUDED.summary_tone,
          sort_order = EXCLUDED.sort_order,
          is_active = TRUE,
          updated_at = now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code = 'ATTENDANCE_DELEGATION'
    `);
  }
}
