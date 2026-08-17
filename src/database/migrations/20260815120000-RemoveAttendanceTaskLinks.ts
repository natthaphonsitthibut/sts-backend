import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Retires per-classroom attendance links (task type `ATTENDANCE`). Creating one
 * has already been rejected in `TaskLifecycleService` since per-teacher links
 * (`teacher_access_grants`) replaced them; this removes the leftover rows and
 * the join table that only that flow wrote to, then constrains `tasks.task_type`
 * so the retired type cannot come back through a raw insert.
 *
 * Row data survives in migration-owned archive tables so `down()` is lossless
 * until the separately reviewed retention migration purges those archives.
 * After that purge, `down()` still restores the schema but cannot reconstruct
 * the retired rows.
 */
export class RemoveAttendanceTaskLinks20260815120000 implements MigrationInterface {
  name = 'RemoveAttendanceTaskLinks20260815120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Snapshot links BEFORE deleting tasks: task_links.task_id cascades, so the
    // rows would already be gone if this ran after the DELETE.
    await queryRunner.query(`
      CREATE TABLE retired_attendance_tasks_20260815 AS
      SELECT * FROM tasks WHERE task_type = 'ATTENDANCE'
    `);
    await queryRunner.query(`
      CREATE TABLE retired_attendance_task_links_20260815 AS
      SELECT link.*
      FROM task_links link
      JOIN tasks task ON task.id = link.task_id
      WHERE task.task_type = 'ATTENDANCE'
    `);
    await queryRunner.query(`
      CREATE TABLE retired_task_link_timetable_slots_20260815
      AS TABLE task_link_timetable_slots WITH DATA
    `);

    await queryRunner.query(`
      COMMENT ON TABLE retired_attendance_tasks_20260815 IS
        'Rollback archive for RemoveAttendanceTaskLinks20260815120000; not application-readable'
    `);
    await queryRunner.query(`
      COMMENT ON TABLE retired_attendance_task_links_20260815 IS
        'Rollback archive for RemoveAttendanceTaskLinks20260815120000; not application-readable'
    `);
    await queryRunner.query(`
      COMMENT ON TABLE retired_task_link_timetable_slots_20260815 IS
        'Rollback archive for RemoveAttendanceTaskLinks20260815120000; not application-readable'
    `);

    // task_links (and anything cascading from them) follow the parent tasks.
    await queryRunner.query(`DELETE FROM tasks WHERE task_type = 'ATTENDANCE'`);

    await queryRunner.query(`DROP TABLE task_link_timetable_slots`);

    await queryRunner.query(`
      ALTER TABLE tasks
        ADD CONSTRAINT chk_tasks_task_type CHECK (task_type IN ('VISIT', 'LOGIN'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTaskArchive = await queryRunner.hasTable('retired_attendance_tasks_20260815');
    const hasLinkArchive = await queryRunner.hasTable('retired_attendance_task_links_20260815');
    const hasSlotArchive = await queryRunner.hasTable('retired_task_link_timetable_slots_20260815');

    await queryRunner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_task_type`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_link_timetable_slots (
        id BIGSERIAL PRIMARY KEY,
        task_link_id UUID NOT NULL
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

    // tasks before task_links (FK task_id), links before their slot rows.
    if (hasTaskArchive) {
      await queryRunner.query(`
        INSERT INTO tasks SELECT * FROM retired_attendance_tasks_20260815
      `);
    }
    if (hasLinkArchive) {
      await queryRunner.query(`
        INSERT INTO task_links SELECT * FROM retired_attendance_task_links_20260815
      `);
    }
    if (hasSlotArchive) {
      await queryRunner.query(`
        INSERT INTO task_link_timetable_slots
        SELECT * FROM retired_task_link_timetable_slots_20260815
      `);
      await queryRunner.query(`
        SELECT setval(
          pg_get_serial_sequence('task_link_timetable_slots', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 0) FROM task_link_timetable_slots), 1)
        )
      `);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS retired_task_link_timetable_slots_20260815`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_attendance_task_links_20260815`);
    await queryRunner.query(`DROP TABLE IF EXISTS retired_attendance_tasks_20260815`);
  }
}
