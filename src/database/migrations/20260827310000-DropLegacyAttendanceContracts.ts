import type { MigrationInterface, QueryRunner } from 'typeorm';

const EFFECTIVE_RECORDS_VIEW = `
  CREATE VIEW attendance_effective_records WITH (security_invoker = true) AS
  SELECT
    (('x' || substr(md5(session.id::text || ':' || roster.student_uuid::text), 1, 16))::bit(64)::bigint)
      AS "AttendanceID",
    roster.student_uuid,
    session.id AS session_id,
    session.school_id AS "SchoolID_Onec",
    classroom.grade_level_id AS "GradeLevelID_Onec",
    classroom.legacy_room_number AS "RoomID_Onec",
    term.academic_year AS "AcademicYear_Onec",
    term.semester::int AS "Semester_Onec",
    session.attendance_date AS "AttendanceDate",
    session.period AS "Period",
    session.session_kind,
    COALESCE(exception.attendance_status_code::int, 1)::smallint AS "AttendanceStatus",
    COALESCE(exception.marked_at, session.submitted_at, session.checking_started_at) AS "RecordedAt",
    COALESCE(
      NULLIF(trim(marker_teacher.first_name || ' ' || marker_teacher.last_name), ''),
      NULLIF(trim(submitter_teacher.first_name || ' ' || submitter_teacher.last_name), ''),
      submitter_user.username,
      'classroom-check-in'
    )::varchar AS "RecordedBy",
    COALESCE(exception.marked_at, session.submitted_at, session.checking_started_at) AS marked_at,
    COALESCE(marker_teacher.id, submitter_teacher.id) AS recorded_by_teacher_id,
    school_subject.subject_id
  FROM attendance_sessions session
  JOIN attendance_session_roster roster ON roster.session_id = session.id
  JOIN school_terms term ON term.id = session.school_term_id
  JOIN school_classrooms classroom ON classroom.id = session.classroom_id
  JOIN classroom_subjects classroom_subject ON classroom_subject.id = session.classroom_subject_id
  JOIN school_subjects school_subject ON school_subject.id = classroom_subject.school_subject_id
  LEFT JOIN attendance_exceptions exception
    ON exception.session_id = session.id
   AND exception.student_uuid = roster.student_uuid
   AND exception.deleted_at IS NULL
  LEFT JOIN school_teacher_memberships marker_membership
    ON marker_membership.id = exception.marked_by_teacher_membership_id
  LEFT JOIN teachers marker_teacher ON marker_teacher.id = marker_membership.teacher_id
  LEFT JOIN school_teacher_memberships submitter_membership
    ON submitter_membership.id = session.submitted_by_teacher_membership_id
  LEFT JOIN teachers submitter_teacher ON submitter_teacher.id = submitter_membership.teacher_id
  LEFT JOIN users submitter_user ON submitter_user.id = session.submitted_by
  WHERE session.record_storage_mode = 'EXCEPTIONS'
    AND session.status IN ('SUBMITTED', 'REOPENED')
    AND session.deleted_at IS NULL
`;

const ATTENDANCE_DAY_VIEW = `
  CREATE VIEW attendance_day WITH (security_invoker = true) AS
  SELECT
    (array_agg(mark."AttendanceID" ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS "AttendanceID",
    mark.student_uuid,
    mark."AttendanceDate",
    mark."AcademicYear_Onec",
    mark."Semester_Onec",
    CASE
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" <> 4) = 0 THEN 4
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" IN (1, 3)) = 0 THEN 2
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" = 3) > 0 THEN 3
      ELSE 1
    END AS "AttendanceStatus",
    (array_agg(mark."RecordedBy" ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS "RecordedBy",
    MIN(mark."RecordedAt") AS "RecordedAt",
    COUNT(*) FILTER (WHERE mark."AttendanceStatus" = 3)::int AS late_periods,
    (array_agg(mark.recorded_by_teacher_id ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS recorded_by_teacher_id
  FROM attendance_effective_records mark
  WHERE mark.session_kind = 'SUBJECT'
  GROUP BY mark.student_uuid, mark."AttendanceDate", mark."AcademicYear_Onec", mark."Semester_Onec"
`;

const ATTENDANCE_SUBJECT_DAY_VIEW = `
  CREATE VIEW attendance_subject_day WITH (security_invoker = true) AS
  SELECT
    (array_agg(mark."AttendanceID" ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS "AttendanceID",
    mark.student_uuid,
    mark."AttendanceDate",
    mark."AcademicYear_Onec",
    mark."Semester_Onec",
    mark.subject_id,
    CASE
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" <> 4) = 0 THEN 4
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" IN (1, 3)) = 0 THEN 2
      WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" = 3) > 0 THEN 3
      ELSE 1
    END AS "AttendanceStatus",
    (array_agg(mark."RecordedBy" ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS "RecordedBy",
    MIN(mark."RecordedAt") AS "RecordedAt",
    COUNT(*) FILTER (WHERE mark."AttendanceStatus" = 3)::int AS late_periods,
    (array_agg(mark.recorded_by_teacher_id ORDER BY mark."Period", mark."AttendanceID"))[1]
      AS recorded_by_teacher_id
  FROM attendance_effective_records mark
  WHERE mark.session_kind = 'SUBJECT'
  GROUP BY mark.student_uuid, mark."AttendanceDate", mark."AcademicYear_Onec",
           mark."Semester_Onec", mark.subject_id
`;

/**
 * Contract phase after classroom links, classroom subject offerings and
 * exception attendance have been live-tested. This migration is intentionally
 * irreversible: a rollback must restore the pre-deploy database backup because
 * keeping copied legacy tables would defeat the destructive-cleanup contract.
 */
export class DropLegacyAttendanceContracts20260827310000 implements MigrationInterface {
  name = 'DropLegacyAttendanceContracts20260827310000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $replacement_guards$
      DECLARE missing_homerooms bigint;
      DECLARE missing_offerings bigint;
      DECLARE missing_session_contract bigint;
      DECLARE live_provenance bigint;
      DECLARE legacy_welfare bigint;
      BEGIN
        SELECT COUNT(*) INTO missing_homerooms
        FROM classroom_teacher_assignments legacy
        LEFT JOIN classroom_homeroom_teachers target
          ON target.classroom_id = legacy.classroom_id
         AND target.school_id = legacy.school_id
         AND target.teacher_membership_id = legacy.teacher_membership_id
        WHERE legacy.assignment_kind = 'HOMEROOM'
          AND legacy.assignment_status = 'ACTIVE'
          AND legacy.deleted_at IS NULL
          AND target.classroom_id IS NULL;

        SELECT COUNT(*) INTO missing_offerings
        FROM (
          SELECT coverage.classroom_id, curriculum.subject_id
          FROM curriculum_subject_teachers coverage
          JOIN curriculum_subjects curriculum ON curriculum.id = coverage.curriculum_subject_id
          WHERE coverage.deleted_at IS NULL AND curriculum.deleted_at IS NULL
          UNION
          SELECT slot.classroom_id, slot.subject_id
          FROM timetable_slots slot WHERE slot.deleted_at IS NULL
          UNION
          SELECT assignment.classroom_id, assignment.subject_id
          FROM classroom_teacher_assignments assignment
          WHERE assignment.assignment_kind = 'SUBJECT'
            AND assignment.assignment_status = 'ACTIVE'
            AND assignment.deleted_at IS NULL
            AND assignment.subject_id IS NOT NULL
        ) source
        WHERE NOT EXISTS (
          SELECT 1
          FROM classroom_subjects offering
          JOIN school_subjects school_subject
            ON school_subject.id = offering.school_subject_id
           AND school_subject.subject_id = source.subject_id
           AND school_subject.deleted_at IS NULL
           AND school_subject.subject_status = 'ACTIVE'
          WHERE offering.classroom_id = source.classroom_id
            AND offering.deleted_at IS NULL
            AND offering.offering_status = 'ACTIVE'
        );

        SELECT COUNT(*) INTO missing_session_contract
        FROM attendance_sessions session
        WHERE session.classroom_id IS NULL
           OR session.classroom_subject_id IS NULL
           OR session.checking_started_at IS NULL
           OR session.record_storage_mode NOT IN ('FULL_ROSTER', 'EXCEPTIONS')
           OR (
             session.record_storage_mode = 'FULL_ROSTER'
             AND (
               session.status NOT IN ('SUBMITTED', 'REOPENED')
               OR NOT EXISTS (
                 SELECT 1 FROM attendance mark WHERE mark.session_id = session.id
               )
             )
           );

        SELECT missing_session_contract + COUNT(*) INTO missing_session_contract
        FROM attendance_sessions legacy
        JOIN attendance_sessions target
          ON target.school_term_id = legacy.school_term_id
         AND target.classroom_id = legacy.classroom_id
         AND target.classroom_subject_id = legacy.classroom_subject_id
         AND target.attendance_date = legacy.attendance_date
         AND target.record_storage_mode = 'EXCEPTIONS'
         AND target.deleted_at IS NULL
        WHERE legacy.record_storage_mode = 'FULL_ROSTER'
          AND legacy.deleted_at IS NULL;

        SELECT
          (SELECT COUNT(*) FROM attendance_import_files WHERE timetable_slot_id IS NOT NULL)
          + (SELECT COUNT(*) FROM student_observations WHERE source_timetable_slot_id IS NOT NULL)
          + (SELECT COUNT(*) FROM student_observations WHERE source_assignment_id IS NOT NULL)
          + (SELECT COUNT(*) FROM student_observations WHERE source_teacher_access_grant_id IS NOT NULL)
          + (SELECT COUNT(*) FROM student_observation_revisions
             WHERE source_teacher_access_grant_id IS NOT NULL)
        INTO live_provenance;

        SELECT
          (SELECT COUNT(*) FROM student_term WHERE COALESCE("DisabilityID_Onec", 0) <> 0)
          + (SELECT COUNT(*) FROM student_term
             WHERE COALESCE("DisadvantageEducationID_Onec", 0) <> 0)
        INTO legacy_welfare;

        IF missing_homerooms <> 0 OR missing_offerings <> 0
           OR missing_session_contract <> 0 OR live_provenance <> 0 OR legacy_welfare <> 0 THEN
          RAISE EXCEPTION
            'DropLegacyAttendanceContracts guard failed: homeroom %, offering %, session %, provenance %, welfare %',
            missing_homerooms, missing_offerings, missing_session_contract,
            live_provenance, legacy_welfare;
        END IF;
      END
      $replacement_guards$;
    `);

    // Materialize the old per-period records as the new subject-day truth.
    // Multiple periods of the same subject/day intentionally collapse using
    // the same rules as the historical attendance_subject_day view.
    await queryRunner.query(`
      CREATE TEMP TABLE legacy_attendance_logical ON COMMIT DROP AS
      SELECT
        session.school_term_id,
        session.school_id,
        session.classroom_id,
        session.classroom_subject_id,
        session.attendance_date,
        mark.student_uuid,
        CASE
          WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" <> 4) = 0 THEN 4
          WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" IN (1, 3)) = 0 THEN 2
          WHEN COUNT(*) FILTER (WHERE mark."AttendanceStatus" = 3) > 0 THEN 3
          ELSE 1
        END::smallint AS attendance_status_code,
        MIN(COALESCE(mark.marked_at, mark."RecordedAt", session.submitted_at,
                     session.checking_started_at)) AS marked_at,
        MAX(COALESCE(mark.marked_at, mark."RecordedAt", session.submitted_at,
                     session.checking_started_at)) AS last_marked_at,
        MIN(COALESCE(mark.created_at, session.created_at, NOW())) AS created_at,
        MIN(mark.created_by) AS created_by,
        MAX(COALESCE(mark.updated_at, mark.created_at, session.updated_at, NOW())) AS updated_at,
        MAX(mark.updated_by) AS updated_by,
        (ARRAY_AGG(
          mark.recorded_by_teacher_id
          ORDER BY COALESCE(mark.marked_at, mark."RecordedAt", session.submitted_at,
                            session.checking_started_at), mark."AttendanceID"
        ) FILTER (WHERE mark.recorded_by_teacher_id IS NOT NULL))[1]
          AS recorded_by_teacher_id,
        (ARRAY_AGG(
          recorder_user.id
          ORDER BY COALESCE(mark.marked_at, mark."RecordedAt", session.submitted_at,
                            session.checking_started_at), mark."AttendanceID"
        ) FILTER (WHERE recorder_user.id IS NOT NULL))[1]
          AS recorded_by_user_id
      FROM attendance mark
      JOIN attendance_sessions session ON session.id = mark.session_id
      LEFT JOIN users recorder_user ON recorder_user.username = mark."RecordedBy"
      WHERE session.record_storage_mode = 'FULL_ROSTER'
        AND session.deleted_at IS NULL
      GROUP BY session.school_term_id, session.school_id, session.classroom_id,
               session.classroom_subject_id, session.attendance_date, mark.student_uuid
    `);

    await queryRunner.query(`
      INSERT INTO attendance_sessions (
        id, school_term_id, school_id, grade_level_id, room_id, classroom_id,
        attendance_date, period, session_kind, subject_id, classroom_subject_id,
        status, expected_roster_count, recorded_count, revision,
        submitted_at, submitted_by, created_at, created_by, updated_at, updated_by,
        checking_started_at, exception_count, record_storage_mode,
        started_by_teacher_membership_id, submitted_by_teacher_membership_id
      )
      SELECT
        gen_random_uuid(), session.school_term_id, session.school_id,
        MIN(session.grade_level_id), MIN(session.room_id), session.classroom_id,
        session.attendance_date, NULL, 'SUBJECT', MIN(session.subject_id),
        session.classroom_subject_id,
        CASE WHEN BOOL_OR(session.status = 'REOPENED') THEN 'REOPENED' ELSE 'SUBMITTED' END,
        COUNT(DISTINCT logical.student_uuid)::int,
        COUNT(DISTINCT logical.student_uuid)::int,
        MAX(session.revision), MAX(logical.last_marked_at),
        COALESCE(
          (ARRAY_AGG(session.submitted_by ORDER BY session.submitted_at DESC NULLS LAST)
            FILTER (WHERE session.submitted_by IS NOT NULL))[1],
          (ARRAY_AGG(logical.recorded_by_user_id ORDER BY logical.marked_at)
            FILTER (WHERE logical.recorded_by_user_id IS NOT NULL))[1]
        ),
        MIN(session.created_at), MIN(session.created_by), MAX(session.updated_at),
        MAX(session.updated_by),
        MIN(COALESCE(session.checking_started_at, logical.marked_at)),
        COUNT(DISTINCT logical.student_uuid)
          FILTER (WHERE logical.attendance_status_code <> 1)::int,
        'EXCEPTIONS',
        COALESCE(
          (ARRAY_AGG(session.started_by_teacher_membership_id)
            FILTER (WHERE session.started_by_teacher_membership_id IS NOT NULL))[1],
          (ARRAY_AGG(recorder_membership.id ORDER BY
            (recorder_membership.membership_status = 'ACTIVE') DESC,
            recorder_membership.id
          ) FILTER (WHERE recorder_membership.id IS NOT NULL))[1]
        ),
        COALESCE(
          (ARRAY_AGG(session.submitted_by_teacher_membership_id)
            FILTER (WHERE session.submitted_by_teacher_membership_id IS NOT NULL))[1],
          (ARRAY_AGG(recorder_membership.id ORDER BY
            (recorder_membership.membership_status = 'ACTIVE') DESC,
            recorder_membership.id
          ) FILTER (WHERE recorder_membership.id IS NOT NULL))[1]
        )
      FROM attendance_sessions session
      JOIN legacy_attendance_logical logical
        ON logical.school_term_id = session.school_term_id
       AND logical.classroom_id = session.classroom_id
       AND logical.classroom_subject_id = session.classroom_subject_id
       AND logical.attendance_date = session.attendance_date
      LEFT JOIN school_teacher_memberships recorder_membership
        ON recorder_membership.teacher_id = logical.recorded_by_teacher_id
       AND recorder_membership.school_id = session.school_id
      WHERE session.record_storage_mode = 'FULL_ROSTER'
        AND session.deleted_at IS NULL
      GROUP BY session.school_term_id, session.school_id, session.classroom_id,
               session.classroom_subject_id, session.attendance_date
    `);

    await queryRunner.query(`
      INSERT INTO attendance_session_roster (
        session_id, school_id, student_uuid, created_at, created_by, updated_at, updated_by
      )
      SELECT target.id, logical.school_id, logical.student_uuid,
             logical.created_at, logical.created_by, logical.updated_at, logical.updated_by
      FROM legacy_attendance_logical logical
      JOIN attendance_sessions target
        ON target.school_term_id = logical.school_term_id
       AND target.classroom_id = logical.classroom_id
       AND target.classroom_subject_id = logical.classroom_subject_id
       AND target.attendance_date = logical.attendance_date
       AND target.record_storage_mode = 'EXCEPTIONS'
       AND target.deleted_at IS NULL
      ON CONFLICT (session_id, student_uuid) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO attendance_exceptions (
        session_id, school_id, student_uuid, attendance_status_code,
        absence_reason_code, marked_at, created_at, created_by, updated_at, updated_by
      )
      SELECT target.id, logical.school_id, logical.student_uuid,
             logical.attendance_status_code,
             CASE WHEN logical.attendance_status_code = 2 THEN 'UNKNOWN' ELSE NULL END,
             logical.marked_at, logical.created_at, logical.created_by,
             logical.updated_at, logical.updated_by
      FROM legacy_attendance_logical logical
      JOIN attendance_sessions target
        ON target.school_term_id = logical.school_term_id
       AND target.classroom_id = logical.classroom_id
       AND target.classroom_subject_id = logical.classroom_subject_id
       AND target.attendance_date = logical.attendance_date
       AND target.record_storage_mode = 'EXCEPTIONS'
       AND target.deleted_at IS NULL
      WHERE logical.attendance_status_code <> 1
    `);

    await queryRunner.query(`
      DO $attendance_reconciliation$
      DECLARE logical_rows bigint;
      DECLARE roster_rows bigint;
      DECLARE logical_exceptions bigint;
      DECLARE stored_exceptions bigint;
      DECLARE status_mismatches bigint;
      BEGIN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE attendance_status_code <> 1)
          INTO logical_rows, logical_exceptions
        FROM legacy_attendance_logical;

        SELECT COUNT(*) INTO roster_rows
        FROM attendance_session_roster roster
        JOIN attendance_sessions target ON target.id = roster.session_id
        WHERE target.record_storage_mode = 'EXCEPTIONS'
          AND target.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM legacy_attendance_logical logical
            WHERE logical.school_term_id = target.school_term_id
              AND logical.classroom_id = target.classroom_id
              AND logical.classroom_subject_id = target.classroom_subject_id
              AND logical.attendance_date = target.attendance_date
          );

        SELECT COUNT(*) INTO stored_exceptions
        FROM attendance_exceptions exception
        JOIN attendance_sessions target ON target.id = exception.session_id
        WHERE target.record_storage_mode = 'EXCEPTIONS'
          AND exception.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM legacy_attendance_logical logical
            WHERE logical.school_term_id = target.school_term_id
              AND logical.classroom_id = target.classroom_id
              AND logical.classroom_subject_id = target.classroom_subject_id
              AND logical.attendance_date = target.attendance_date
          );

        SELECT COUNT(*) INTO status_mismatches
        FROM legacy_attendance_logical logical
        JOIN attendance_sessions target
          ON target.school_term_id = logical.school_term_id
         AND target.classroom_id = logical.classroom_id
         AND target.classroom_subject_id = logical.classroom_subject_id
         AND target.attendance_date = logical.attendance_date
         AND target.record_storage_mode = 'EXCEPTIONS'
         AND target.deleted_at IS NULL
        JOIN attendance_session_roster roster
          ON roster.session_id = target.id
         AND roster.student_uuid = logical.student_uuid
         AND roster.deleted_at IS NULL
        LEFT JOIN attendance_exceptions exception
          ON exception.session_id = target.id
         AND exception.student_uuid = logical.student_uuid
         AND exception.deleted_at IS NULL
        WHERE logical.attendance_status_code <> COALESCE(exception.attendance_status_code, 1);

        IF logical_rows <> roster_rows
           OR logical_exceptions <> stored_exceptions
           OR status_mismatches <> 0 THEN
          RAISE EXCEPTION
            'DropLegacyAttendanceContracts attendance mismatch: logical/roster %/%, exception %/%, status %',
            logical_rows, roster_rows, logical_exceptions, stored_exceptions, status_mismatches;
        END IF;
      END
      $attendance_reconciliation$;
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT IF EXISTS chk_attendance_sessions_subject_shape
    `);

    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(`DROP TABLE attendance`);

    await queryRunner.query(`
      DELETE FROM attendance_exceptions exception
      USING attendance_sessions legacy
      WHERE exception.session_id = legacy.id
        AND legacy.record_storage_mode = 'FULL_ROSTER'
    `);
    await queryRunner.query(`
      DELETE FROM attendance_session_roster roster
      USING attendance_sessions legacy
      WHERE roster.session_id = legacy.id
        AND legacy.record_storage_mode = 'FULL_ROSTER'
    `);
    await queryRunner.query(`
      DELETE FROM attendance_sessions WHERE record_storage_mode = 'FULL_ROSTER'
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_sessions_full_roster_session`);

    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT IF EXISTS fk_attendance_sessions_timetable_slot,
        DROP CONSTRAINT IF EXISTS chk_attendance_sessions_record_storage_contract,
        DROP CONSTRAINT IF EXISTS chk_attendance_sessions_storage_mode,
        DROP COLUMN timetable_slot_id,
        DROP COLUMN subject_id
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD CONSTRAINT chk_attendance_sessions_storage_mode
          CHECK (record_storage_mode = 'EXCEPTIONS'),
        ADD CONSTRAINT chk_attendance_sessions_subject_shape
          CHECK (
            classroom_id IS NOT NULL
            AND classroom_subject_id IS NOT NULL
            AND period IS NULL
          )
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_import_files
        DROP CONSTRAINT IF EXISTS fk_attendance_import_files_slot,
        DROP COLUMN timetable_slot_id
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions
        DROP CONSTRAINT IF EXISTS fk_student_observation_revisions_grant,
        DROP COLUMN source_teacher_access_grant_id
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        DROP CONSTRAINT IF EXISTS fk_student_observations_teacher_grant,
        DROP CONSTRAINT IF EXISTS fk_student_observations_assignment,
        DROP CONSTRAINT IF EXISTS fk_student_observations_timetable_slot,
        DROP COLUMN source_teacher_access_grant_id,
        DROP COLUMN source_assignment_id,
        DROP COLUMN source_timetable_slot_id
    `);
    await queryRunner.query(`
      ALTER TABLE student_term
        DROP COLUMN "DisabilityID_Onec",
        DROP COLUMN "DisadvantageEducationID_Onec"
    `);

    await queryRunner.query(`DROP TABLE teacher_access_attendance_assignments`);
    await queryRunner.query(`DROP TABLE teacher_access_grant_capabilities`);
    await queryRunner.query(`DROP TABLE teacher_access_grant_assignments`);
    await queryRunner.query(`DROP TABLE teacher_access_grants`);
    await queryRunner.query(`DROP TABLE curriculum_subject_teachers`);
    await queryRunner.query(`DROP TABLE curriculum_subjects`);
    await queryRunner.query(`DROP TABLE classroom_teacher_assignments`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher_from_assignment()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher(BIGINT, INTEGER)`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS sync_classroom_homeroom_teacher(BIGINT)`);
    await queryRunner.query(`DROP TABLE IF EXISTS timetable_slot_legacy_teacher_backup`);
    await queryRunner.query(`DROP TABLE timetable_slot_teachers`);
    await queryRunner.query(`DROP TABLE timetable_slots`);
    await queryRunner.query(`DROP TABLE school_period_times`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS resolve_timetable_slot_classroom()`);

    await queryRunner.query(`
      UPDATE users SET permissions = permissions - ARRAY[
        'timetable', 'manage-curriculum', 'manage-teacher-access'
      ]::text[]
      WHERE permissions ?| ARRAY['timetable', 'manage-curriculum', 'manage-teacher-access'];
      UPDATE roles SET default_permissions = default_permissions - ARRAY[
        'timetable', 'manage-curriculum', 'manage-teacher-access'
      ]::text[]
      WHERE default_permissions ?| ARRAY['timetable', 'manage-curriculum', 'manage-teacher-access'];
    `);

    await queryRunner.query(EFFECTIVE_RECORDS_VIEW);
    await queryRunner.query(ATTENDANCE_DAY_VIEW);
    await queryRunner.query(ATTENDANCE_SUBJECT_DAY_VIEW);
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'DropLegacyAttendanceContracts is intentionally irreversible. Restore the verified pre-deploy pg_dump, then deploy the previous application build.',
      ),
    );
  }
}
