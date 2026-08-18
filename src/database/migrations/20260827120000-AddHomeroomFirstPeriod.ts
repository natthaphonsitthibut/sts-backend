import type { MigrationInterface, QueryRunner } from 'typeorm';

const HOMEROOM_SUBJECT_CODE = 'HOMEROOM';

/**
 * Gives every school a โฮมรูม period at the start of the day.
 *
 * โฮมรูม is not a curriculum choice — it is the homeroom teacher's own period,
 * and until now a room could only get one by someone adding a subject and a
 * timetable row by hand. Every existing period moves down one so the day still
 * teaches the same subjects in the same order, and period 1 becomes โฮมรูม with
 * the room's homeroom teacher on it.
 *
 * `school_period_times` already defines periods 1-8 for every school, so the
 * shift lands on times that already exist.
 */
export class AddHomeroomFirstPeriod20260827120000 implements MigrationInterface {
  name = 'AddHomeroomFirstPeriod20260827120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO subjects (code, name_th, is_active)
        VALUES ($1, 'โฮมรูม', TRUE)
        ON CONFLICT (code) DO UPDATE
        SET name_th = EXCLUDED.name_th,
            is_active = TRUE,
            deleted_at = NULL,
            updated_at = now()
      `,
      [HOMEROOM_SUBJECT_CODE],
    );

    // Nothing to move on a fresh install; the insert below then seeds nothing
    // either, which is correct — there is no timetable to add a period to yet.
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM timetable_slots WHERE deleted_at IS NULL AND period = 1
       AND subject_id <> (SELECT id FROM subjects WHERE code = $1)`,
      [HOMEROOM_SUBJECT_CODE],
    )) as Array<{ count: number }>;
    if (count === 0) return;

    // The unique slot key contains `period`, so a single +1 sweep would collide
    // with the row it is about to move into. Park the periods out of range
    // first, then bring them back one higher.
    await queryRunner.query(
      `UPDATE timetable_slots SET period = period + 1000 WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `UPDATE timetable_slots SET period = period - 999 WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(
      `
        INSERT INTO timetable_slots (
          school_term_id, school_id, grade_level_id, room_no, day_of_week, period,
          subject_id, classroom_id, teacher_membership_id
        )
        SELECT DISTINCT
          slot.school_term_id, slot.school_id, slot.grade_level_id, slot.room_no,
          slot.day_of_week, 1,
          (SELECT id FROM subjects WHERE code = $1),
          slot.classroom_id,
          homeroom.teacher_membership_id
        FROM timetable_slots slot
        LEFT JOIN classroom_teacher_assignments homeroom
          ON homeroom.classroom_id = slot.classroom_id
         AND homeroom.assignment_kind = 'HOMEROOM'
         AND homeroom.assignment_status = 'ACTIVE'
         AND homeroom.deleted_at IS NULL
        WHERE slot.deleted_at IS NULL
        ON CONFLICT DO NOTHING
      `,
      [HOMEROOM_SUBJECT_CODE],
    );

    // Teachers hang off the join table; the column above is the legacy copy.
    await queryRunner.query(
      `
        INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
        SELECT slot.id, slot.teacher_membership_id
        FROM timetable_slots slot
        WHERE slot.deleted_at IS NULL
          AND slot.period = 1
          AND slot.teacher_membership_id IS NOT NULL
          AND slot.subject_id = (SELECT id FROM subjects WHERE code = $1)
        ON CONFLICT DO NOTHING
      `,
      [HOMEROOM_SUBJECT_CODE],
    );

    // The homeroom teacher now teaches โฮมรูม, the same row the assignment
    // screen creates from here on.
    await queryRunner.query(
      `
        INSERT INTO classroom_teacher_assignments (
          school_id, classroom_id, teacher_membership_id, subject_id, assignment_kind
        )
        SELECT homeroom.school_id, homeroom.classroom_id, homeroom.teacher_membership_id,
               (SELECT id FROM subjects WHERE code = $1), 'SUBJECT'
        FROM classroom_teacher_assignments homeroom
        WHERE homeroom.assignment_kind = 'HOMEROOM'
          AND homeroom.assignment_status = 'ACTIVE'
          AND homeroom.deleted_at IS NULL
        ON CONFLICT DO NOTHING
      `,
      [HOMEROOM_SUBJECT_CODE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        DELETE FROM timetable_slot_teachers
        WHERE timetable_slot_id IN (
          SELECT id FROM timetable_slots
          WHERE period = 1 AND subject_id = (SELECT id FROM subjects WHERE code = $1)
        )
      `,
      [HOMEROOM_SUBJECT_CODE],
    );
    await queryRunner.query(
      `
        DELETE FROM timetable_slots
        WHERE period = 1 AND subject_id = (SELECT id FROM subjects WHERE code = $1)
      `,
      [HOMEROOM_SUBJECT_CODE],
    );
    await queryRunner.query(
      `UPDATE timetable_slots SET period = period + 1000 WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `UPDATE timetable_slots SET period = period - 1001 WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `
        UPDATE classroom_teacher_assignments
        SET assignment_status = 'INACTIVE'
        WHERE assignment_kind = 'SUBJECT'
          AND subject_id = (SELECT id FROM subjects WHERE code = $1)
      `,
      [HOMEROOM_SUBJECT_CODE],
    );
  }
}
