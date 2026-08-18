import type { MigrationInterface, QueryRunner } from 'typeorm';

const SHOWCASE_SCHOOL_ID = 10010004;
const CALENDAR_REASON = 'ข้อมูลสาธิตการเช็กชื่อรายวิชาแบบย่อ';

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
    await queryRunner.query(
      `
        INSERT INTO compact_demo_school_targets_20260826 (school_id, requested_day_count)
        SELECT school.id,
          CASE
            WHEN school.id = $1 THEN 5
            ELSE (3 + MOD(school.id, 3))::smallint
          END
        FROM schools school
        WHERE school.id BETWEEN 10010001 AND 10010010
          AND school.school_status = 'ACTIVE'
      `,
      [SHOWCASE_SCHOOL_ID],
    );

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
    // Pick the latest real school days from each school's active term. A day
    // is eligible only when its timetable actually contains at least one slot.
    await queryRunner.query(`
      CREATE TEMP TABLE compact_demo_selected_days_20260826
      ON COMMIT DROP AS
      WITH existing_anchors AS MATERIALIZED (
        SELECT
          record."SchoolID_Onec" AS school_id,
          MAX(record."AttendanceDate")::date AS latest_attendance_date
        FROM attendance record
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = record."SchoolID_Onec"
        GROUP BY record."SchoolID_Onec"
      ),
      active_terms AS MATERIALIZED (
        SELECT DISTINCT ON (term.school_id)
          term.id AS school_term_id,
          term.school_id,
          term.academic_year,
          term.semester,
          term.starts_on,
          LEAST(
            CURRENT_DATE - 1,
            GREATEST(
              COALESCE(term.ends_on, term.starts_on),
              term.starts_on + INTERVAL '42 days',
              COALESCE(anchor.latest_attendance_date, term.starts_on)
            )
          )::date AS seed_window_ends_on,
          target.requested_day_count
        FROM school_terms term
        JOIN compact_demo_school_targets_20260826 target
          ON target.school_id = term.school_id
        LEFT JOIN existing_anchors anchor ON anchor.school_id = term.school_id
        WHERE term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
        ORDER BY term.school_id, term.starts_on DESC, term.id DESC
      ),
      ranked_days AS (
        SELECT
          term.school_term_id,
          term.school_id,
          term.academic_year,
          term.semester,
          candidate_date::date AS attendance_date,
          ROW_NUMBER() OVER (
            PARTITION BY term.school_id
            ORDER BY candidate_date DESC
          )::smallint AS day_rank,
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
      WHERE day_rank <= requested_day_count
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

    // Some imported demo terms were created as a one-day term even though the
    // same term owns a full weekly timetable. Keep the retained attendance
    // internally valid by extending only those malformed end dates to the last
    // selected (past) school day.
    await queryRunner.query(`
      WITH selected_range AS (
        SELECT school_term_id, MAX(attendance_date) AS last_attendance_date
        FROM compact_demo_selected_days_20260826
        GROUP BY school_term_id
      )
      UPDATE school_terms term
      SET ends_on = selected.last_attendance_date,
          updated_at = now()
      FROM selected_range selected
      WHERE term.id = selected.school_term_id
        AND (term.ends_on IS NULL OR term.ends_on < selected.last_attendance_date)
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
