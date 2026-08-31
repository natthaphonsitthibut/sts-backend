import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which link a register was taken through.
 *
 * The room, the subject and the teacher were already on the row, but not the
 * door: a teacher who checks in from the app and one who checks in from a link
 * handed to them looked identical afterwards. The school issuing a link needs to
 * see what came of it — who opened it and what they recorded — and that question
 * has no answer unless the session says which link it came from.
 *
 * Nullable and `ON DELETE SET NULL`: every register taken in the app has no link
 * at all, and closing a link must never take the attendance with it.
 */
export class RecordAttendanceSessionLink20260830120000 implements MigrationInterface {
  name = 'RecordAttendanceSessionLink20260830120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD COLUMN classroom_attendance_link_id UUID,
        ADD CONSTRAINT fk_attendance_sessions_classroom_link
          FOREIGN KEY (classroom_attendance_link_id)
          REFERENCES classroom_attendance_links(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_sessions_classroom_link
        ON attendance_sessions (classroom_attendance_link_id, checking_started_at DESC)
        WHERE classroom_attendance_link_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_sessions_classroom_link`);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT fk_attendance_sessions_classroom_link,
        DROP COLUMN classroom_attendance_link_id
    `);
  }
}
