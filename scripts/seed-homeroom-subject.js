require('dotenv/config');

const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');
/** Removes exactly what this script seeds, so the demo can go back and forth. */
const REVERT = process.argv.includes('--revert');

const SUBJECT_CODE = 'HOMEROOM';
const SUBJECT_NAME = 'โฮมรูม';
/** Mon–Fri. A homeroom round belongs to the school week, not to Saturday clubs. */
const SCHOOL_DAYS = [1, 2, 3, 4, 5];

/**
 * Seeds โฮมรูม as a real subject: an offering in หลักสูตร, a period at the end of
 * each school day in ตารางสอน, and the room's homeroom teacher as its teacher.
 *
 * Being ครูประจำชั้น does not make anyone the homeroom subject's teacher by
 * itself — the link is an explicit assignment exactly like any other subject, so
 * this script writes that assignment rather than letting the app infer it.
 *
 * Idempotent: every insert leans on an existing unique index, so re-running adds
 * only what is missing and never overwrites a row an admin edited. Scoped to
 * ACTIVE terms so past terms keep the timetable they were taught with.
 */
async function main() {
  await appDataSource.initialize();
  const runner = appDataSource.createQueryRunner();
  await runner.connect();

  try {
    const [before] = await runner.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM subjects WHERE code = $1 AND deleted_at IS NULL) AS subject,
          (SELECT COUNT(*)::int FROM timetable_slots slot
             JOIN subjects s ON s.id = slot.subject_id
            WHERE s.code = $1 AND slot.deleted_at IS NULL) AS slots,
          (SELECT COUNT(*)::int FROM classroom_teacher_assignments a
             JOIN subjects s ON s.id = a.subject_id
            WHERE s.code = $1 AND a.deleted_at IS NULL) AS assignments,
          (SELECT COUNT(*)::int FROM curriculum_subjects c
             JOIN subjects s ON s.id = c.subject_id
            WHERE s.code = $1 AND c.deleted_at IS NULL) AS offerings
      `,
      [SUBJECT_CODE],
    );
    const [candidates] = await runner.query(
      `
        SELECT COUNT(*)::int AS classrooms
        FROM school_classrooms classroom
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN classroom_teacher_assignments homeroom
          ON homeroom.classroom_id = classroom.id
         AND homeroom.assignment_kind = 'HOMEROOM'
         AND homeroom.assignment_status = 'ACTIVE'
         AND homeroom.deleted_at IS NULL
        WHERE classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
      `,
    );

    console.log(`subject / offerings / slots / assignments : ${before.subject} / ${before.offerings} / ${before.slots} / ${before.assignments}`);
    console.log(`classrooms with a homeroom teacher       : ${candidates.classrooms}`);

    if (AUDIT_ONLY) {
      console.log('audit-only: no changes written');
      return;
    }

    if (REVERT) {
      await runner.startTransaction();
      // Rounds recorded against a homeroom period keep the period alive: report
      // them and stop rather than deleting attendance a teacher took.
      const [recorded] = await runner.query(
        `
          SELECT COUNT(*)::int AS sessions
          FROM attendance_sessions session
          JOIN timetable_slots slot ON slot.id = session.timetable_slot_id
          JOIN subjects subject ON subject.id = slot.subject_id
          WHERE subject.code = $1
            AND session.deleted_at IS NULL
        `,
        [SUBJECT_CODE],
      );
      const [observed] = await runner.query(
        `
          SELECT COUNT(*)::int AS observations
          FROM student_observations observation
          JOIN classroom_teacher_assignments assignment
            ON assignment.id = observation.source_assignment_id
          JOIN subjects subject ON subject.id = assignment.subject_id
          WHERE subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      if (observed.observations > 0) {
        await runner.rollbackTransaction();
        console.log(
          `refusing to revert: ${observed.observations} observation(s) were filed against the homeroom subject`,
        );
        return;
      }
      if (recorded.sessions > 0) {
        await runner.rollbackTransaction();
        console.log(
          `refusing to revert: ${recorded.sessions} attendance round(s) were already recorded on a homeroom period`,
        );
        return;
      }
      await runner.query(
        `
          DELETE FROM curriculum_subject_teachers coverage
          USING curriculum_subjects offering, subjects subject
          WHERE coverage.curriculum_subject_id = offering.id
            AND subject.id = offering.subject_id
            AND subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      await runner.query(
        `
          DELETE FROM curriculum_subjects offering
          USING subjects subject
          WHERE subject.id = offering.subject_id AND subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      await runner.query(
        `
          DELETE FROM timetable_slots slot
          USING subjects subject
          WHERE subject.id = slot.subject_id AND subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      // A teacher link syncs every active assignment into its own scope table,
      // so drop those derived rows first — they are rebuilt on the next use.
      await runner.query(
        `
          DELETE FROM teacher_access_grant_assignments scope
          USING classroom_teacher_assignments assignment, subjects subject
          WHERE scope.assignment_id = assignment.id
            AND subject.id = assignment.subject_id
            AND subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      await runner.query(
        `
          DELETE FROM classroom_teacher_assignments assignment
          USING subjects subject
          WHERE subject.id = assignment.subject_id AND subject.code = $1
        `,
        [SUBJECT_CODE],
      );
      await runner.query(`DELETE FROM subjects WHERE code = $1`, [SUBJECT_CODE]);
      await runner.commitTransaction();
      console.log('reverted: homeroom subject, timetable periods, assignments and curriculum rows removed');
      return;
    }

    await runner.startTransaction();

    // Last in the subject list: nothing orders subjects explicitly, so a new row
    // simply carries the highest id.
    await runner.query(
      `
        INSERT INTO subjects (code, name_th, is_active)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (code) DO UPDATE
        SET name_th = EXCLUDED.name_th, is_active = TRUE
      `,
      [SUBJECT_CODE, SUBJECT_NAME],
    );

    // The homeroom teacher becomes the subject teacher through an explicit
    // assignment, the same row shape a normal subject uses.
    await runner.query(
      `
        INSERT INTO classroom_teacher_assignments (
          school_id, classroom_id, teacher_membership_id, subject_id,
          assignment_kind, assignment_status, effective_on
        )
        SELECT
          classroom.school_id,
          classroom.id,
          homeroom.teacher_membership_id,
          subject.id,
          'SUBJECT',
          'ACTIVE',
          term.starts_on
        FROM school_classrooms classroom
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN classroom_teacher_assignments homeroom
          ON homeroom.classroom_id = classroom.id
         AND homeroom.assignment_kind = 'HOMEROOM'
         AND homeroom.assignment_status = 'ACTIVE'
         AND homeroom.deleted_at IS NULL
        CROSS JOIN subjects subject
        WHERE subject.code = $1
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
        ON CONFLICT (classroom_id, teacher_membership_id, subject_id)
          WHERE assignment_kind = 'SUBJECT'
            AND assignment_status = 'ACTIVE'
            AND deleted_at IS NULL
          DO NOTHING
      `,
      [SUBJECT_CODE],
    );

    // One period per school day, placed after the last period the room already
    // teaches so it can never collide with the timetable a school built.
    await runner.query(
      `
        INSERT INTO timetable_slots (
          school_term_id, school_id, grade_level_id, room_no, classroom_id,
          day_of_week, period, subject_id, teacher_membership_id
        )
        SELECT
          classroom.school_term_id,
          classroom.school_id,
          classroom.grade_level_id,
          classroom.legacy_room_number,
          classroom.id,
          day.day_of_week,
          COALESCE(
            (
              SELECT MAX(existing.period)
              FROM timetable_slots existing
              WHERE existing.school_term_id = classroom.school_term_id
                AND existing.school_id = classroom.school_id
                AND existing.grade_level_id = classroom.grade_level_id
                AND existing.room_no = classroom.legacy_room_number
                AND existing.day_of_week = day.day_of_week
                AND existing.deleted_at IS NULL
            ),
            0
          ) + 1,
          subject.id,
          homeroom.teacher_membership_id
        FROM school_classrooms classroom
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN classroom_teacher_assignments homeroom
          ON homeroom.classroom_id = classroom.id
         AND homeroom.assignment_kind = 'HOMEROOM'
         AND homeroom.assignment_status = 'ACTIVE'
         AND homeroom.deleted_at IS NULL
        CROSS JOIN subjects subject
        CROSS JOIN unnest($2::int[]) AS day(day_of_week)
        WHERE subject.code = $1
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM timetable_slots taken
            WHERE taken.school_term_id = classroom.school_term_id
              AND taken.school_id = classroom.school_id
              AND taken.grade_level_id = classroom.grade_level_id
              AND taken.room_no = classroom.legacy_room_number
              AND taken.day_of_week = day.day_of_week
              AND taken.subject_id = subject.id
              AND taken.deleted_at IS NULL
          )
        ON CONFLICT (school_term_id, school_id, grade_level_id, room_no, day_of_week, period)
          WHERE deleted_at IS NULL
          DO NOTHING
      `,
      [SUBJECT_CODE, SCHOOL_DAYS],
    );

    // The slot's teacher list is what attendance reads, so mirror the membership
    // into it exactly like the timetable editor does.
    await runner.query(
      `
        INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
        SELECT slot.id, slot.teacher_membership_id
        FROM timetable_slots slot
        JOIN subjects subject ON subject.id = slot.subject_id
        WHERE subject.code = $1
          AND slot.teacher_membership_id IS NOT NULL
          AND slot.deleted_at IS NULL
        ON CONFLICT (timetable_slot_id, teacher_membership_id) DO NOTHING
      `,
      [SUBJECT_CODE],
    );

    // หลักสูตร: the offering per grade, then the teacher coverage per classroom.
    await runner.query(
      `
        INSERT INTO curriculum_subjects (school_id, school_term_id, grade_level_id, subject_id)
        SELECT DISTINCT slot.school_id, slot.school_term_id, slot.grade_level_id, slot.subject_id
        FROM timetable_slots slot
        JOIN subjects subject ON subject.id = slot.subject_id
        WHERE subject.code = $1
          AND slot.deleted_at IS NULL
        ON CONFLICT (school_term_id, grade_level_id, subject_id)
          WHERE deleted_at IS NULL
          DO NOTHING
      `,
      [SUBJECT_CODE],
    );
    await runner.query(
      `
        INSERT INTO curriculum_subject_teachers (
          curriculum_subject_id, school_id, school_term_id, grade_level_id,
          teacher_membership_id, classroom_id
        )
        SELECT DISTINCT
          offering.id,
          slot.school_id,
          slot.school_term_id,
          slot.grade_level_id,
          slot.teacher_membership_id,
          slot.classroom_id
        FROM timetable_slots slot
        JOIN subjects subject ON subject.id = slot.subject_id
        JOIN curriculum_subjects offering
          ON offering.school_term_id = slot.school_term_id
         AND offering.grade_level_id = slot.grade_level_id
         AND offering.subject_id = slot.subject_id
         AND offering.deleted_at IS NULL
        WHERE subject.code = $1
          AND slot.teacher_membership_id IS NOT NULL
          AND slot.deleted_at IS NULL
        ON CONFLICT (curriculum_subject_id, teacher_membership_id, classroom_id)
          WHERE deleted_at IS NULL
          DO NOTHING
      `,
      [SUBJECT_CODE],
    );

    await runner.commitTransaction();

    const [after] = await runner.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM timetable_slots slot
             JOIN subjects s ON s.id = slot.subject_id
            WHERE s.code = $1 AND slot.deleted_at IS NULL) AS slots,
          (SELECT COUNT(*)::int FROM classroom_teacher_assignments a
             JOIN subjects s ON s.id = a.subject_id
            WHERE s.code = $1 AND a.deleted_at IS NULL) AS assignments,
          (SELECT COUNT(*)::int FROM curriculum_subjects c
             JOIN subjects s ON s.id = c.subject_id
            WHERE s.code = $1 AND c.deleted_at IS NULL) AS offerings,
          (SELECT COUNT(*)::int FROM curriculum_subject_teachers t
             JOIN curriculum_subjects c ON c.id = t.curriculum_subject_id
             JOIN subjects s ON s.id = c.subject_id
            WHERE s.code = $1 AND t.deleted_at IS NULL) AS coverage,
          (SELECT COUNT(DISTINCT slot.period)::int FROM timetable_slots slot
             JOIN subjects s ON s.id = slot.subject_id
            WHERE s.code = $1 AND slot.deleted_at IS NULL) AS distinct_periods
      `,
      [SUBJECT_CODE],
    );

    console.log(`offerings   : ${before.offerings} -> ${after.offerings} (coverage ${after.coverage})`);
    console.log(`slots       : ${before.slots} -> ${after.slots} (periods used: ${after.distinct_periods})`);
    console.log(`assignments : ${before.assignments} -> ${after.assignments}`);
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
