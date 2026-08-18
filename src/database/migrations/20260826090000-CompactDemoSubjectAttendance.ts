import type { MigrationInterface, QueryRunner } from 'typeorm';

const SHOWCASE_SCHOOL_ID = 10010004;
const CALENDAR_REASON = 'ข้อมูลสาธิตการเช็กชื่อรายวิชาแบบย่อ';
const DEMO_ACADEMIC_YEAR = 2569;
const DEMO_SEMESTER = 1;
const DEMO_TERM_START = '2026-05-16';
const DEMO_TERM_END = '2026-10-10';

/**
 * Replaces the oversized month-long demo attendance set with a compact,
 * timetable-backed subject-attendance sample. This migration intentionally
 * does not touch cases: the canonical absence monitor remains responsible for
 * opening unassigned cases after a student is absent for three complete days.
 *
 * The removed demo history is deliberately non-reversible. Keeping a second
 * copy for rollback would defeat the production disk-recovery objective.
 */
export class CompactDemoSubjectAttendance20260826090000 implements MigrationInterface {
  name = 'CompactDemoSubjectAttendance20260826090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const targets = (await queryRunner.query(
      `
        SELECT id
        FROM schools
        WHERE id BETWEEN 10010001 AND 10010010
          AND school_status = 'ACTIVE'
      `,
    )) as Array<{ id: number }>;
    if (targets.length === 0) return;

    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_school_targets_20260826 (
        school_id INTEGER PRIMARY KEY,
        requested_day_count SMALLINT NOT NULL
      ) ON COMMIT DROP
    `);
    await queryRunner.query(`
        INSERT INTO compact_demo_school_targets_20260826 (school_id, requested_day_count)
        SELECT school.id, 5::smallint
        FROM schools school
        WHERE school.id BETWEEN 10010001 AND 10010010
          AND school.school_status = 'ACTIVE'
    `);

    // Preserve any operational school outside the known demo-id range. The
    // four related tables are truncated together because the provenance tables
    // hold FKs to attendance/session rows.
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_retained_sessions_20260826
      ON COMMIT DROP AS
      SELECT session.*
      FROM attendance_sessions session
      WHERE session.session_kind = 'SUBJECT'
        AND NOT EXISTS (
        SELECT 1
        FROM compact_demo_school_targets_20260826 target
        WHERE target.school_id = session.school_id
      )
    `);
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_retained_attendance_20260826
      ON COMMIT DROP AS
      SELECT record.*
      FROM attendance record
      WHERE record.session_kind = 'SUBJECT'
        AND NOT EXISTS (
        SELECT 1
        FROM compact_demo_school_targets_20260826 target
        WHERE target.school_id = record."SchoolID_Onec"
      )
    `);
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_retained_session_backup_20260826
      ON COMMIT DROP AS
      SELECT backup.*
      FROM demo_provenance_attendance_session_backup_20260724 backup
      JOIN compact_demo_retained_sessions_20260826 session
        ON session.id = backup.session_id
    `);
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_retained_attendance_backup_20260826
      ON COMMIT DROP AS
      SELECT backup.*
      FROM demo_provenance_attendance_backup_20260724 backup
      JOIN compact_demo_retained_attendance_20260826 record
        ON record."AttendanceID" = backup.attendance_id
    `);

    const missingTermOne = (await queryRunner.query(
      `
        SELECT target.school_id
        FROM compact_demo_school_targets_20260826 target
        LEFT JOIN school_terms term
          ON term.school_id = target.school_id
         AND term.academic_year = $1
         AND term.semester = $2
         AND term.deleted_at IS NULL
        GROUP BY target.school_id
        HAVING COUNT(term.id) <> 1
        ORDER BY target.school_id
      `,
      [DEMO_ACADEMIC_YEAR, DEMO_SEMESTER],
    )) as Array<{ school_id: number }>;
    if (missingTermOne.length > 0) {
      throw new Error(
        `CompactDemoSubjectAttendance: every target school must have exactly one 2569/1 term: ${JSON.stringify(missingTermOne)}`,
      );
    }

    const referencedTermTwo = (await queryRunner.query(
      `
        SELECT
          term.school_id,
          term.id AS school_term_id,
          (
            SELECT COUNT(*) FROM attendance_import_files row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM attendance_sessions row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM curriculum_subjects row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM school_classrooms row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM student_term row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM teacher_access_grants row
            WHERE row.school_term_id = term.id
          ) + (
            SELECT COUNT(*) FROM timetable_slots row
            WHERE row.school_term_id = term.id
          ) AS operational_reference_count
        FROM school_terms term
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = term.school_id
        WHERE term.academic_year = $1
          AND term.semester = 2
          AND term.deleted_at IS NULL
      `,
      [DEMO_ACADEMIC_YEAR],
    )) as Array<{
      school_id: number;
      school_term_id: number;
      operational_reference_count: number | string;
    }>;
    const blockedTermTwo = referencedTermTwo.filter(
      (term) => Number(term.operational_reference_count) > 0,
    );
    if (blockedTermTwo.length > 0) {
      throw new Error(
        `CompactDemoSubjectAttendance: 2569/2 term has operational references: ${JSON.stringify(blockedTermTwo)}`,
      );
    }

    await queryRunner.query(
      `
        DELETE FROM school_terms term
        USING compact_demo_school_targets_20260826 target
        WHERE target.school_id = term.school_id
          AND term.academic_year = $1
          AND term.semester = 2
          AND term.deleted_at IS NULL
      `,
      [DEMO_ACADEMIC_YEAR],
    );

    await queryRunner.query(
      `
        UPDATE school_terms term
        SET starts_on = $3::date,
            ends_on = $4::date,
            status = 'ACTIVE',
            updated_at = now()
        FROM compact_demo_school_targets_20260826 target
        WHERE target.school_id = term.school_id
          AND term.academic_year = $1
          AND term.semester = $2
          AND term.deleted_at IS NULL
      `,
      [DEMO_ACADEMIC_YEAR, DEMO_SEMESTER, DEMO_TERM_START, DEMO_TERM_END],
    );

    await queryRunner.query(
      `
        DELETE FROM school_calendar_days calendar
        USING school_terms term, compact_demo_school_targets_20260826 target
        WHERE calendar.school_term_id = term.id
          AND target.school_id = term.school_id
          AND term.academic_year = $1
          AND term.semester = $2
      `,
      [DEMO_ACADEMIC_YEAR, DEMO_SEMESTER],
    );
    await queryRunner.query(
      `
        INSERT INTO school_calendar_days (
          school_term_id,
          calendar_date,
          day_type,
          reason,
          source
        )
        SELECT
          term.id,
          candidate_date::date,
          'SCHOOL_DAY',
          $5,
          'BACKFILL'
        FROM school_terms term
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = term.school_id
        CROSS JOIN LATERAL GENERATE_SERIES(
          $3::date,
          $4::date,
          INTERVAL '1 day'
        ) candidate_date
        WHERE term.academic_year = $1
          AND term.semester = $2
          AND term.deleted_at IS NULL
          AND EXTRACT(ISODOW FROM candidate_date) BETWEEN 1 AND 5
      `,
      [DEMO_ACADEMIC_YEAR, DEMO_SEMESTER, DEMO_TERM_START, DEMO_TERM_END, CALENDAR_REASON],
    );
    // Pick one latest real school day for each weekday (Monday-Friday) from
    // the configured 2569/1 term. A day is eligible only when its timetable
    // actually contains at least one slot.
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_selected_days_20260826
      ON COMMIT DROP AS
      WITH active_terms AS MATERIALIZED (
        SELECT
          term.id AS school_term_id,
          term.school_id,
          term.academic_year,
          term.semester,
          term.starts_on,
          LEAST(CURRENT_DATE - 1, term.ends_on)::date AS seed_window_ends_on,
          target.requested_day_count
        FROM school_terms term
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = term.school_id
        WHERE term.academic_year = 2569
          AND term.semester = 1
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
      ),
      ranked_days AS (
        SELECT
          term.school_term_id,
          term.school_id,
          term.academic_year,
          term.semester,
          candidate_date::date AS attendance_date,
          EXTRACT(ISODOW FROM candidate_date)::smallint AS day_rank,
          ROW_NUMBER() OVER (
            PARTITION BY term.school_id, EXTRACT(ISODOW FROM candidate_date)
            ORDER BY candidate_date DESC
          )::smallint AS weekday_rank,
          term.requested_day_count
        FROM active_terms term
        CROSS JOIN LATERAL GENERATE_SERIES(
          term.starts_on::timestamp,
          term.seed_window_ends_on::timestamp,
          INTERVAL '1 day'
        ) candidate_date
        WHERE EXTRACT(ISODOW FROM candidate_date) BETWEEN 1 AND 5
          AND NOT EXISTS (
            SELECT 1
            FROM school_calendar_days blocked_day
            WHERE blocked_day.school_term_id = term.school_term_id
              AND blocked_day.calendar_date = candidate_date::date
              AND blocked_day.day_type <> 'SCHOOL_DAY'
              AND blocked_day.deleted_at IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM timetable_slots slot
            WHERE slot.school_term_id = term.school_term_id
              AND slot.school_id = term.school_id
              AND slot.day_of_week = EXTRACT(ISODOW FROM candidate_date)::int
              AND slot.deleted_at IS NULL
          )
      )
      SELECT
        school_term_id,
        school_id,
        academic_year,
        semester,
        attendance_date,
        day_rank
      FROM ranked_days
      WHERE weekday_rank = 1
    `);

    const incompleteDayWindows = (await queryRunner.query(`
      SELECT
        target.school_id,
        target.requested_day_count,
        COUNT(selected.attendance_date)::int AS selected_day_count
      FROM compact_demo_school_targets_20260826 target
      LEFT JOIN compact_demo_selected_days_20260826 selected
        ON selected.school_id = target.school_id
      GROUP BY target.school_id, target.requested_day_count
      HAVING COUNT(selected.attendance_date) <> target.requested_day_count
      ORDER BY target.school_id
    `)) as Array<{
      school_id: number;
      requested_day_count: number;
      selected_day_count: number;
    }>;
    if (incompleteDayWindows.length > 0) {
      throw new Error(
        `CompactDemoSubjectAttendance: insufficient timetable-backed school days: ${JSON.stringify(incompleteDayWindows)}`,
      );
    }

    // Repair active-term timetable slots that have no usable explicit teacher.
    // Prefer a real teacher already related to the slot/class; only the final
    // fallback chooses the least-loaded active named teacher in the same school.
    await queryRunner.query(`
      WITH roster_classrooms AS MATERIALIZED (
        SELECT DISTINCT enrollment.classroom_id, enrollment.school_term_id
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = enrollment."SchoolID_Onec"
        WHERE enrollment.deleted_at IS NULL
          AND enrollment.classroom_id IS NOT NULL
          AND enrollment.school_term_id IS NOT NULL
      ),
      missing_slots AS MATERIALIZED (
        SELECT DISTINCT
          slot.id AS timetable_slot_id,
          slot.school_id,
          slot.classroom_id,
          slot.subject_id,
          slot.teacher_membership_id
        FROM timetable_slots slot
        JOIN school_terms term
          ON term.id = slot.school_term_id
         AND term.academic_year = 2569
         AND term.semester = 1
         AND term.status = 'ACTIVE'
         AND term.deleted_at IS NULL
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = slot.school_id
        JOIN roster_classrooms roster
          ON roster.classroom_id = slot.classroom_id
         AND roster.school_term_id = slot.school_term_id
        WHERE slot.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM timetable_slot_teachers existing_link
            JOIN school_teacher_memberships existing_membership
              ON existing_membership.id = existing_link.teacher_membership_id
             AND existing_membership.school_id = slot.school_id
             AND existing_membership.membership_status = 'ACTIVE'
             AND existing_membership.deleted_at IS NULL
            JOIN teachers existing_teacher
              ON existing_teacher.id = existing_membership.teacher_id
             AND existing_teacher.teacher_status = 'ACTIVE'
             AND existing_teacher.deleted_at IS NULL
            WHERE existing_link.timetable_slot_id = slot.id
              AND NULLIF(BTRIM(CONCAT_WS(
                ' ', existing_teacher.first_name, existing_teacher.last_name
              )), '') IS NOT NULL
          )
      ),
      ranked_candidates AS (
        SELECT
          slot.timetable_slot_id,
          candidate.teacher_membership_id,
          ROW_NUMBER() OVER (
            PARTITION BY slot.timetable_slot_id
            ORDER BY
              candidate.source_priority,
              candidate.explicit_slot_count,
              candidate.teacher_membership_id
          ) AS candidate_rank
        FROM missing_slots slot
        JOIN LATERAL (
          SELECT
            membership.id AS teacher_membership_id,
            source.source_priority,
            (
              SELECT COUNT(*)::int
              FROM timetable_slot_teachers workload
              WHERE workload.teacher_membership_id = membership.id
            ) AS explicit_slot_count
          FROM (
            SELECT slot.teacher_membership_id, 1 AS source_priority
            WHERE slot.teacher_membership_id IS NOT NULL

            UNION ALL

            SELECT assignment.teacher_membership_id, 2 AS source_priority
            FROM classroom_teacher_assignments assignment
            WHERE assignment.classroom_id = slot.classroom_id
              AND assignment.subject_id = slot.subject_id
              AND assignment.assignment_kind = 'SUBJECT'
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL

            UNION ALL

            SELECT assignment.teacher_membership_id, 3 AS source_priority
            FROM classroom_teacher_assignments assignment
            WHERE assignment.classroom_id = slot.classroom_id
              AND assignment.assignment_kind = 'HOMEROOM'
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL

            UNION ALL

            SELECT school_membership.id, 4 AS source_priority
            FROM school_teacher_memberships school_membership
            WHERE school_membership.school_id = slot.school_id
          ) source
          JOIN school_teacher_memberships membership
            ON membership.id = source.teacher_membership_id
           AND membership.school_id = slot.school_id
           AND membership.membership_status = 'ACTIVE'
           AND membership.deleted_at IS NULL
          JOIN teachers teacher
            ON teacher.id = membership.teacher_id
           AND teacher.teacher_status = 'ACTIVE'
           AND teacher.deleted_at IS NULL
          WHERE NULLIF(BTRIM(CONCAT_WS(' ', teacher.first_name, teacher.last_name)), '') IS NOT NULL
        ) candidate ON TRUE
      )
      INSERT INTO timetable_slot_teachers (
        timetable_slot_id,
        teacher_membership_id,
        created_by
      )
      SELECT
        candidate.timetable_slot_id,
        candidate.teacher_membership_id,
        NULL
      FROM ranked_candidates candidate
      WHERE candidate.candidate_rank = 1
      ON CONFLICT (timetable_slot_id, teacher_membership_id) DO NOTHING
    `);

    const slotsWithoutTeachers = (await queryRunner.query(`
      WITH roster_classrooms AS MATERIALIZED (
        SELECT DISTINCT enrollment.classroom_id, enrollment.school_term_id
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = enrollment."SchoolID_Onec"
        WHERE enrollment.deleted_at IS NULL
          AND enrollment.classroom_id IS NOT NULL
          AND enrollment.school_term_id IS NOT NULL
      )
      SELECT
        selected.school_id,
        COUNT(*)::int AS missing_slot_count
      FROM compact_demo_selected_days_20260826 selected
      JOIN timetable_slots slot
        ON slot.school_term_id = selected.school_term_id
       AND slot.school_id = selected.school_id
       AND slot.day_of_week = EXTRACT(ISODOW FROM selected.attendance_date)::int
       AND slot.deleted_at IS NULL
      JOIN roster_classrooms roster
        ON roster.classroom_id = slot.classroom_id
       AND roster.school_term_id = slot.school_term_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM timetable_slot_teachers slot_teacher
        JOIN school_teacher_memberships membership
          ON membership.id = slot_teacher.teacher_membership_id
         AND membership.school_id = slot.school_id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN teachers teacher
          ON teacher.id = membership.teacher_id
         AND teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
        WHERE slot_teacher.timetable_slot_id = slot.id
          AND NULLIF(BTRIM(CONCAT_WS(' ', teacher.first_name, teacher.last_name)), '') IS NOT NULL
      )
      GROUP BY selected.school_id
      ORDER BY selected.school_id
    `)) as Array<{ school_id: number; missing_slot_count: number }>;
    if (slotsWithoutTeachers.length > 0) {
      throw new Error(
        `CompactDemoSubjectAttendance: timetable slots lack an active named teacher: ${JSON.stringify(slotsWithoutTeachers)}`,
      );
    }

    // The destructive step runs only after the source term, timetable, roster,
    // date window and teacher assignments have passed preflight validation.
    await queryRunner.query(`
      TRUNCATE TABLE
        demo_provenance_attendance_backup_20260724,
        demo_provenance_attendance_session_backup_20260724,
        attendance,
        attendance_sessions
    `);
    await queryRunner.query(`
      INSERT INTO attendance_sessions
      SELECT * FROM compact_demo_retained_sessions_20260826
    `);
    await queryRunner.query(`
      INSERT INTO attendance
      SELECT * FROM compact_demo_retained_attendance_20260826
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_attendance_session_backup_20260724
      SELECT * FROM compact_demo_retained_session_backup_20260826
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_attendance_backup_20260724
      SELECT * FROM compact_demo_retained_attendance_backup_20260826
    `);

    await queryRunner.query(
      `
        INSERT INTO school_calendar_days (
          school_term_id,
          calendar_date,
          day_type,
          reason,
          source
        )
        SELECT DISTINCT
          selected.school_term_id,
          selected.attendance_date,
          'SCHOOL_DAY',
          $1,
          'BACKFILL'
        FROM compact_demo_selected_days_20260826 selected
        ON CONFLICT (school_term_id, calendar_date) DO NOTHING
      `,
      [CALENDAR_REASON],
    );

    // Build sessions from the real timetable, roster and assigned teacher.
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_subject_sessions_20260826
      ON COMMIT DROP AS
      WITH current_roster AS MATERIALIZED (
        SELECT
          enrollment.student_uuid,
          enrollment.person_uuid,
          enrollment.classroom_id,
          enrollment."SchoolID_Onec" AS school_id,
          enrollment."GradeLevelID_Onec" AS grade_level_id,
          enrollment."RoomID_Onec"::int AS room_no,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester,
          enrollment.school_term_id
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = enrollment."SchoolID_Onec"
        WHERE enrollment.deleted_at IS NULL
          AND enrollment.classroom_id IS NOT NULL
          AND enrollment.school_term_id IS NOT NULL
      ),
      roster_counts AS (
        SELECT classroom_id, school_term_id, COUNT(*)::int AS roster_count
        FROM current_roster
        GROUP BY classroom_id, school_term_id
      )
      SELECT
        selected.school_term_id,
        selected.school_id,
        selected.academic_year,
        selected.semester,
        selected.attendance_date,
        selected.day_rank,
        slot.classroom_id,
        slot.grade_level_id,
        slot.room_no,
        slot.period,
        slot.subject_id,
        slot.id AS timetable_slot_id,
        roster.roster_count,
        recorder.teacher_id AS recorded_by_teacher_id,
        recorder.teacher_name AS recorded_by,
        MIN(slot.period) OVER (
          PARTITION BY selected.school_id, slot.classroom_id, selected.attendance_date
        ) AS first_period
      FROM compact_demo_selected_days_20260826 selected
      JOIN timetable_slots slot
        ON slot.school_term_id = selected.school_term_id
       AND slot.school_id = selected.school_id
       AND slot.day_of_week = EXTRACT(ISODOW FROM selected.attendance_date)::int
       AND slot.deleted_at IS NULL
      JOIN roster_counts roster
        ON roster.classroom_id = slot.classroom_id
       AND roster.school_term_id = slot.school_term_id
      JOIN LATERAL (
        SELECT
          teacher.id AS teacher_id,
          LEFT(BTRIM(CONCAT_WS(' ', teacher.first_name, teacher.last_name)), 100) AS teacher_name
        FROM timetable_slot_teachers slot_teacher
        JOIN school_teacher_memberships membership
          ON membership.id = slot_teacher.teacher_membership_id
         AND membership.school_id = slot.school_id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN teachers teacher
          ON teacher.id = membership.teacher_id
         AND teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
        WHERE slot_teacher.timetable_slot_id = slot.id
          AND NULLIF(BTRIM(CONCAT_WS(' ', teacher.first_name, teacher.last_name)), '') IS NOT NULL
        ORDER BY membership.id, teacher.id
        LIMIT 1
      ) recorder ON TRUE
    `);

    await queryRunner.query(`
      INSERT INTO attendance_sessions (
        school_term_id,
        school_id,
        grade_level_id,
        room_id,
        attendance_date,
        period,
        session_kind,
        status,
        expected_roster_count,
        recorded_count,
        submitted_at,
        subject_id,
        timetable_slot_id,
        created_by,
        updated_by
      )
      SELECT
        seed.school_term_id,
        seed.school_id,
        seed.grade_level_id,
        seed.room_no,
        seed.attendance_date,
        seed.period,
        'SUBJECT',
        'SUBMITTED',
        seed.roster_count,
        seed.roster_count,
        (seed.attendance_date + TIME '17:00') AT TIME ZONE 'Asia/Bangkok',
        seed.subject_id,
        seed.timetable_slot_id,
        NULL,
        NULL
      FROM compact_demo_subject_sessions_20260826 seed
      ON CONFLICT (
        school_term_id,
        grade_level_id,
        room_id,
        attendance_date,
        period,
        session_kind
      ) DO UPDATE SET
        status = 'SUBMITTED',
        expected_roster_count = EXCLUDED.expected_roster_count,
        recorded_count = EXCLUDED.recorded_count,
        submitted_at = EXCLUDED.submitted_at,
        subject_id = EXCLUDED.subject_id,
        timetable_slot_id = EXCLUDED.timetable_slot_id,
        deleted_at = NULL,
        updated_at = now()
    `);

    await queryRunner.query(
      `
      WITH current_roster AS MATERIALIZED (
        SELECT
          enrollment.student_uuid,
          enrollment.person_uuid,
          enrollment.classroom_id,
          enrollment."SchoolID_Onec" AS school_id,
          enrollment."GradeLevelID_Onec" AS grade_level_id,
          enrollment."RoomID_Onec"::int AS room_no,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester,
          enrollment.school_term_id,
          ROW_NUMBER() OVER (
            PARTITION BY enrollment."SchoolID_Onec", enrollment.classroom_id
            ORDER BY MD5(enrollment.student_uuid::text), enrollment.student_uuid
          ) AS classroom_student_rank,
          COUNT(*) OVER (
            PARTITION BY enrollment."SchoolID_Onec", enrollment.classroom_id
          ) AS classroom_student_count
        FROM student_term enrollment
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = enrollment.person_uuid
         AND current_enrollment.selected_student_uuid = enrollment.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = enrollment."SchoolID_Onec"
        WHERE enrollment.deleted_at IS NULL
          AND enrollment.classroom_id IS NOT NULL
          AND enrollment.school_term_id IS NOT NULL
      ),
      attendance_seed AS (
        SELECT
          student.student_uuid,
          student.school_id,
          student.grade_level_id,
          student.room_no,
          student.academic_year,
          student.semester,
          session_seed.attendance_date,
          session_seed.day_rank,
          session_seed.period,
          session_seed.first_period,
          session_seed.recorded_by,
          session_seed.recorded_by_teacher_id,
          stored_session.id AS session_id,
          student.school_id = $1
            AND student.classroom_student_rank
              <= GREATEST(1, CEIL(student.classroom_student_count::numeric * 0.20))
            AS is_showcase_risk_student,
          MOD(
            ABS(HASHTEXTEXTENDED(
              student.student_uuid::text || ':' || session_seed.attendance_date::text,
              41
            )),
            100
          )::int AS student_day_roll,
          MOD(
            ABS(HASHTEXTEXTENDED(
              student.student_uuid::text || ':' || session_seed.timetable_slot_id::text,
              73
            )),
            100
          )::int AS student_period_roll
        FROM compact_demo_subject_sessions_20260826 session_seed
        JOIN current_roster student
          ON student.classroom_id = session_seed.classroom_id
         AND student.school_term_id = session_seed.school_term_id
        JOIN attendance_sessions stored_session
          ON stored_session.school_term_id = session_seed.school_term_id
         AND stored_session.grade_level_id = session_seed.grade_level_id
         AND stored_session.room_id = session_seed.room_no
         AND stored_session.attendance_date = session_seed.attendance_date
         AND stored_session.period = session_seed.period
         AND stored_session.session_kind = 'SUBJECT'
      ),
      statused AS (
        SELECT seed.*,
          CASE
            WHEN seed.is_showcase_risk_student AND seed.day_rank <= 3 THEN 2
            WHEN seed.student_day_roll < 4 THEN 2
            WHEN seed.student_day_roll < 8 THEN 4
            WHEN seed.student_day_roll < 16 AND seed.period = seed.first_period THEN 3
            WHEN seed.student_day_roll < 16 THEN 1
            WHEN seed.student_period_roll < 2 THEN 2
            ELSE 1
          END::smallint AS attendance_status,
          (
            (seed.attendance_date + TIME '07:30') AT TIME ZONE 'Asia/Bangkok'
            + ((seed.period - 1) * INTERVAL '50 minutes')
            + (
              MOD(ABS(HASHTEXTEXTENDED(seed.student_uuid::text, 97)), 180)::int
              * INTERVAL '1 second'
            )
          ) AS marked_at
        FROM attendance_seed seed
      )
      INSERT INTO attendance (
        student_uuid,
        "SchoolID_Onec",
        "GradeLevelID_Onec",
        "RoomID_Onec",
        "AcademicYear_Onec",
        "Semester_Onec",
        "AttendanceDate",
        "Period",
        session_kind,
        "AttendanceStatus",
        "RecordedAt",
        marked_at,
        "RecordedBy",
        recorded_by_teacher_id,
        session_id,
        created_by,
        updated_by
      )
      SELECT
        statused.student_uuid,
        statused.school_id,
        statused.grade_level_id,
        statused.room_no,
        statused.academic_year,
        statused.semester,
        statused.attendance_date,
        statused.period,
        'SUBJECT',
        statused.attendance_status,
        statused.marked_at + INTERVAL '2 minutes',
        statused.marked_at,
        statused.recorded_by,
        statused.recorded_by_teacher_id,
        statused.session_id,
        NULL,
        NULL
      FROM statused
      ON CONFLICT (student_uuid, "AttendanceDate", "Period")
        WHERE session_kind = 'SUBJECT'
      DO UPDATE SET
        "AttendanceStatus" = EXCLUDED."AttendanceStatus",
        "RecordedAt" = EXCLUDED."RecordedAt",
        marked_at = EXCLUDED.marked_at,
        "RecordedBy" = EXCLUDED."RecordedBy",
        recorded_by_teacher_id = EXCLUDED.recorded_by_teacher_id,
        session_id = EXCLUDED.session_id,
        created_by = NULL,
        updated_by = NULL
    `,
      [SHOWCASE_SCHOOL_ID],
    );

    // Profiles are derived data. Removing only the target schools' profiles
    // makes the canonical startup repair rebuild them from the compact set.
    await queryRunner.query(`
      DELETE FROM student_risk_profiles profile
      USING student_term enrollment, compact_demo_school_targets_20260826 target
      WHERE profile.student_uuid = enrollment.student_uuid
        AND enrollment."SchoolID_Onec" = target.school_id
    `);
  }

  /** The month-long demo data is intentionally not recreated on rollback. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
