import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records when a teacher actually tapped a student's status, separate from when
 * the server wrote the row. `"RecordedAt"` is `now()` at save time, so today an
 * entire class shares one timestamp and the real arrival time is lost.
 *
 * Nullable with no default and no backfill on purpose: rows written before this
 * migration genuinely carry no per-student tap time, and inventing one would
 * make the column lie. `"RecordedAt"` stays the server-side source of truth —
 * `marked_at` is client-supplied and clamped server-side (see
 * AttendanceWriteService.clampMarkedAt), never trusted as-is.
 */
export class AddAttendanceMarkedAt20260815130000 implements MigrationInterface {
  name = 'AddAttendanceMarkedAt20260815130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE attendance ADD COLUMN marked_at TIMESTAMPTZ NULL`);
    await queryRunner.query(`
      COMMENT ON COLUMN attendance.marked_at IS
        'เวลาที่ครูแตะเลือกสถานะจริงบนอุปกรณ์ (client stamp, server clamp ให้อยู่ในวันที่เช็คชื่อและไม่เกินปัจจุบัน). NULL = ไม่ทราบ (แถวก่อน migration นี้ หรือ client ไม่ส่งมา). "RecordedAt" ยังเป็นเวลาที่เซิร์ฟเวอร์เขียนแถวและเป็น server truth'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE attendance DROP COLUMN IF EXISTS marked_at`);
  }
}
