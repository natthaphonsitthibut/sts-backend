import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Phase 1 (Timetable core) — `subjects` is a central master list (chosen over
 * per-room free text per the 2026-07-06 decision), `timetable_slots` binds a
 * subject + teacher to a specific school/grade/room/day/period for a term.
 * `task_links.subject_id` lets an ATTENDANCE link reference a real subject
 * instead of typing one; `subject` (free text) stays as a denormalized label
 * snapshot the frontend still writes alongside it — same pattern as the
 * `student_name`/`school_name` snapshots already on `cases`.
 */
export class AddSubjectsAndTimetable20260707230000 implements MigrationInterface {
  name = 'AddSubjectsAndTimetable20260707230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name_th TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_subjects_code CHECK (length(trim(code)) > 0),
        CONSTRAINT chk_subjects_name_th CHECK (length(trim(name_th)) > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('subjects'));

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS timetable_slots (
        id BIGSERIAL PRIMARY KEY,
        school_term_id BIGINT NOT NULL
          CONSTRAINT fk_timetable_slots_school_term
          REFERENCES school_terms(id) ON DELETE RESTRICT,
        school_id INTEGER NOT NULL
          CONSTRAINT fk_timetable_slots_school
          REFERENCES schools(id) ON DELETE RESTRICT,
        grade_level_id INTEGER NOT NULL
          CONSTRAINT fk_timetable_slots_grade_level
          REFERENCES grade_levels(id) ON DELETE RESTRICT,
        room_no INTEGER NOT NULL,
        day_of_week SMALLINT NOT NULL,
        period SMALLINT NOT NULL,
        subject_id INTEGER NOT NULL
          CONSTRAINT fk_timetable_slots_subject
          REFERENCES subjects(id) ON DELETE RESTRICT,
        teacher_user_id INTEGER
          CONSTRAINT fk_timetable_slots_teacher
          REFERENCES users(id) ON DELETE SET NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_timetable_slots_room_no CHECK (room_no > 0),
        CONSTRAINT chk_timetable_slots_day_of_week CHECK (day_of_week BETWEEN 1 AND 7),
        CONSTRAINT chk_timetable_slots_period CHECK (period > 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('timetable_slots'));
    // Partial (not a plain UNIQUE constraint) so a soft-deleted slot's
    // day/period frees up immediately for a replacement slot.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_slots_slot
        ON timetable_slots (school_term_id, school_id, grade_level_id, room_no, day_of_week, period)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_slots_room
        ON timetable_slots (school_id, grade_level_id, room_no)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher
        ON timetable_slots (teacher_user_id)
        WHERE deleted_at IS NULL AND teacher_user_id IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS subject_id INTEGER
          CONSTRAINT fk_task_links_subject REFERENCES subjects(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links DROP CONSTRAINT IF EXISTS fk_task_links_subject
    `);
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS subject_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_timetable_slots_teacher`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_timetable_slots_room`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_timetable_slots_slot`);
    await queryRunner.query(`DROP TABLE IF EXISTS timetable_slots`);
    await queryRunner.query(`DROP TABLE IF EXISTS subjects`);
  }
}
