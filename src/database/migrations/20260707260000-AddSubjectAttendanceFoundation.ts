import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddSubjectAttendanceFoundation20260707260000 implements MigrationInterface {
  name = 'AddSubjectAttendanceFoundation20260707260000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateResult: unknown = await queryRunner.query(`
      SELECT student_uuid, "AttendanceDate", COUNT(*)::int AS count
      FROM attendance
      WHERE student_uuid IS NOT NULL
      GROUP BY student_uuid, "AttendanceDate"
      HAVING COUNT(*) > 1
      LIMIT 1
    `);
    const duplicates = Array.isArray(duplicateResult) ? duplicateResult : [];
    if (duplicates.length > 0) {
      throw new Error(
        'Cannot add subject attendance foundation: attendance has duplicate daily rows.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS session_kind VARCHAR(16) NOT NULL DEFAULT 'DAILY'
    `);
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_session_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance
        ADD CONSTRAINT chk_attendance_session_kind
        CHECK (session_kind IN ('DAILY', 'SUBJECT'))
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_uuid_date_period`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_daily
        ON attendance (student_uuid, "AttendanceDate")
        WHERE session_kind = 'DAILY'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_subject
        ON attendance (student_uuid, "AttendanceDate", "Period")
        WHERE session_kind = 'SUBJECT'
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD COLUMN IF NOT EXISTS subject_id INTEGER,
        ADD COLUMN IF NOT EXISTS timetable_slot_id BIGINT
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS fk_attendance_sessions_subject`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT fk_attendance_sessions_subject
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS fk_attendance_sessions_timetable_slot`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT fk_attendance_sessions_timetable_slot
        FOREIGN KEY (timetable_slot_id) REFERENCES timetable_slots(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT chk_attendance_sessions_kind
        CHECK (session_kind IN ('DAILY', 'SUBJECT'))
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_subject_shape`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT chk_attendance_sessions_subject_shape
        CHECK (
          (session_kind = 'DAILY' AND subject_id IS NULL AND timetable_slot_id IS NULL)
          OR (session_kind = 'SUBJECT' AND subject_id IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_link_timetable_slots (
        id BIGSERIAL PRIMARY KEY,
        task_link_id TEXT NOT NULL
          CONSTRAINT fk_task_link_timetable_slots_task_link
          REFERENCES task_links(id) ON DELETE CASCADE,
        timetable_slot_id BIGINT NOT NULL
          CONSTRAINT fk_task_link_timetable_slots_slot
          REFERENCES timetable_slots(id) ON DELETE RESTRICT,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_task_link_timetable_slots_link_slot
          UNIQUE (task_link_id, timetable_slot_id)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('task_link_timetable_slots'));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS task_link_timetable_slots`);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_subject_shape`,
    );
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT chk_attendance_sessions_kind
        CHECK (session_kind IN ('DAILY'))
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS fk_attendance_sessions_timetable_slot`,
    );
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS fk_attendance_sessions_subject`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP COLUMN IF EXISTS timetable_slot_id,
        DROP COLUMN IF EXISTS subject_id
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_subject`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_daily`);
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_session_kind`,
    );
    await queryRunner.query(`ALTER TABLE attendance DROP COLUMN IF EXISTS session_kind`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_uuid_date_period
        ON attendance (student_uuid, "AttendanceDate", "Period")
    `);
  }
}
