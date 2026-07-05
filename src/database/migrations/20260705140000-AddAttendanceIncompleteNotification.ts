import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODE = 'ATTENDANCE_INCOMPLETE';

export class AddAttendanceIncompleteNotification20260705140000 implements MigrationInterface {
  name = 'AddAttendanceIncompleteNotification20260705140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS anomaly_notified_at TIMESTAMPTZ`,
    );
    await queryRunner.query(`
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES ('${TYPE_CODE}', 'เช็กชื่อไม่ครบเลยกำหนด', 'attendance', 120)
      ON CONFLICT (code) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [TYPE_CODE]);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP COLUMN IF EXISTS anomaly_notified_at`,
    );
  }
}
