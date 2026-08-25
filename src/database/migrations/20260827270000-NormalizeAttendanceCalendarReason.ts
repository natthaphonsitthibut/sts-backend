import type { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_DEMO_REASON = 'ข้อมูลสาธิตการเช็กชื่อรายวิชาแบบย่อ';
const DOMAIN_REASON = 'วันเรียนตามปฏิทินโรงเรียน';

/** Removes a migration-internal demo label from user-visible calendar data. */
export class NormalizeAttendanceCalendarReason20260827270000 implements MigrationInterface {
  name = 'NormalizeAttendanceCalendarReason20260827270000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      CREATE TABLE attendance_calendar_reason_20260827_backup AS
      SELECT id, reason
      FROM school_calendar_days
      WHERE reason = $1
    `,
      [LEGACY_DEMO_REASON],
    );
    await queryRunner.query(`
      ALTER TABLE attendance_calendar_reason_20260827_backup
        ADD CONSTRAINT pk_attendance_calendar_reason_20260827_backup PRIMARY KEY (id)
    `);
    await queryRunner.query(`UPDATE school_calendar_days SET reason = $2 WHERE reason = $1`, [
      LEGACY_DEMO_REASON,
      DOMAIN_REASON,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE school_calendar_days day
      SET reason = backup.reason
      FROM attendance_calendar_reason_20260827_backup backup
      WHERE day.id = backup.id
        AND day.reason = $1
    `,
      [DOMAIN_REASON],
    );
    await queryRunner.query(`DROP TABLE attendance_calendar_reason_20260827_backup`);
  }
}
