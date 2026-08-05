import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-slot teacher assignments (`timetable_slot_teachers`) and ensures
 * all timetable slots align with `curriculum_subjects`.
 *
 * Subject teacher assignments in curriculum can specify multiple teachers for
 * a single subject (e.g. Art has ครูณัฐพล and ครูเบญจมาศ). On the timetable grid:
 * - A slot can be assigned to a specific teacher (e.g. Monday = ครูณัฐพล)
 * - A slot can be assigned to another specific teacher (e.g. Tuesday = ครูเบญจมาศ)
 * - A slot can be assigned to multiple teachers (e.g. Wednesday = ครูณัฐพล, ครูเบญจมาศ)
 * - A slot with no explicit teachers specified defaults to all teachers assigned
 *   to that subject in curriculum.
 */
export class AddTimetableSlotTeachers20260805150000 implements MigrationInterface {
  name = 'AddTimetableSlotTeachers20260805150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS timetable_slot_teachers (
        timetable_slot_id BIGINT NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by INT,
        CONSTRAINT pk_timetable_slot_teachers PRIMARY KEY (timetable_slot_id, teacher_membership_id),
        CONSTRAINT fk_timetable_slot_teachers_slot
          FOREIGN KEY (timetable_slot_id) REFERENCES timetable_slots(id) ON DELETE CASCADE,
        CONSTRAINT fk_timetable_slot_teachers_membership
          FOREIGN KEY (teacher_membership_id) REFERENCES school_teacher_memberships(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_timetable_slot_teachers_membership
        ON timetable_slot_teachers(teacher_membership_id);
    `);

    // Backfill 1: Populate timetable_slot_teachers from classroom_teacher_assignments (curriculum) and existing slot teachers
    await queryRunner.query(`
      INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
      SELECT DISTINCT ts.id, cta.teacher_membership_id
      FROM timetable_slots ts
      JOIN classroom_teacher_assignments cta
        ON cta.classroom_id = ts.classroom_id
       AND cta.subject_id = ts.subject_id
       AND cta.assignment_kind = 'SUBJECT'
       AND cta.assignment_status = 'ACTIVE'
       AND cta.deleted_at IS NULL
      WHERE ts.deleted_at IS NULL
      ON CONFLICT DO NOTHING;

      INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
      SELECT DISTINCT ts.id, stm.id
      FROM timetable_slots ts
      JOIN school_teacher_memberships stm
        ON stm.id = ts.teacher_membership_id
        OR (stm.teacher_user_id = ts.teacher_user_id AND ts.teacher_user_id IS NOT NULL)
      WHERE ts.deleted_at IS NULL AND stm.deleted_at IS NULL
      ON CONFLICT DO NOTHING;
    `);

    // Backfill 2: Ensure all subjects used in timetable_slots exist in curriculum_subjects
    await queryRunner.query(`
      INSERT INTO curriculum_subjects (school_id, school_term_id, grade_level_id, subject_id)
      SELECT DISTINCT ts.school_id, ts.school_term_id, ts.grade_level_id, ts.subject_id
      FROM timetable_slots ts
      LEFT JOIN curriculum_subjects cs
        ON cs.school_id = ts.school_id
       AND cs.grade_level_id = ts.grade_level_id
       AND cs.subject_id = ts.subject_id
       AND cs.deleted_at IS NULL
      WHERE ts.deleted_at IS NULL AND cs.id IS NULL
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS timetable_slot_teachers;
    `);
  }
}
