import type { MigrationInterface, QueryRunner } from 'typeorm';

const SUBJECT_ONLY_DAY_VIEW = `
  CREATE VIEW attendance_day AS
  SELECT
    (ARRAY_AGG(
      period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
    ))[1] AS "AttendanceID",
    period.student_uuid,
    period."AttendanceDate"::date AS "AttendanceDate",
    period."AcademicYear_Onec" AS "AcademicYear_Onec",
    period."Semester_Onec" AS "Semester_Onec",
    CASE
      WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
      WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
      WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
      ELSE 1
    END AS "AttendanceStatus",
    (ARRAY_AGG(
      period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
    ))[1] AS "RecordedBy",
    MIN(period."RecordedAt") AS "RecordedAt",
    COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods
  FROM attendance period
  LEFT JOIN attendance_sessions period_session ON period_session.id = period.session_id
  WHERE period.session_kind = 'SUBJECT'
    AND (
      period.session_id IS NULL
      OR (
        period_session.status IN ('SUBMITTED', 'REOPENED')
        AND period_session.deleted_at IS NULL
      )
    )
  GROUP BY
    period.student_uuid,
    period."AttendanceDate",
    period."AcademicYear_Onec",
    period."Semester_Onec"
`;

const SUBJECT_WITH_DAILY_FALLBACK_DAY_VIEW = `
  CREATE VIEW attendance_day AS
  SELECT
    subject_day.attendance_id AS "AttendanceID",
    subject_day.student_uuid,
    subject_day.attendance_date AS "AttendanceDate",
    subject_day.academic_year AS "AcademicYear_Onec",
    subject_day.semester AS "Semester_Onec",
    subject_day.status AS "AttendanceStatus",
    subject_day.recorded_by AS "RecordedBy",
    subject_day.recorded_at AS "RecordedAt",
    subject_day.late_periods
  FROM (
    SELECT
      (ARRAY_AGG(
        period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
      ))[1] AS attendance_id,
      period.student_uuid,
      period."AttendanceDate"::date AS attendance_date,
      period."AcademicYear_Onec" AS academic_year,
      period."Semester_Onec" AS semester,
      CASE
        WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" <> 4) = 0 THEN 4
        WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" IN (1, 3)) = 0 THEN 2
        WHEN COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3) > 0 THEN 3
        ELSE 1
      END AS status,
      (ARRAY_AGG(
        period."RecordedBy" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
      ))[1] AS recorded_by,
      MIN(period."RecordedAt") AS recorded_at,
      COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods
    FROM attendance period
    LEFT JOIN attendance_sessions period_session ON period_session.id = period.session_id
    WHERE period.session_kind = 'SUBJECT'
      AND (
        period.session_id IS NULL
        OR (
          period_session.status IN ('SUBMITTED', 'REOPENED')
          AND period_session.deleted_at IS NULL
        )
      )
    GROUP BY
      period.student_uuid,
      period."AttendanceDate",
      period."AcademicYear_Onec",
      period."Semester_Onec"
  ) subject_day

  UNION ALL

  SELECT
    legacy."AttendanceID",
    legacy.student_uuid,
    legacy."AttendanceDate"::date,
    legacy."AcademicYear_Onec",
    legacy."Semester_Onec",
    legacy."AttendanceStatus",
    legacy."RecordedBy",
    legacy."RecordedAt",
    CASE WHEN legacy."AttendanceStatus" = 3 THEN 1 ELSE 0 END
  FROM attendance legacy
  LEFT JOIN attendance_sessions legacy_session ON legacy_session.id = legacy.session_id
  WHERE legacy.session_kind = 'DAILY'
    AND (
      legacy.session_id IS NULL
      OR (
        legacy_session.status IN ('SUBMITTED', 'REOPENED')
        AND legacy_session.deleted_at IS NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM attendance period
      WHERE period.student_uuid = legacy.student_uuid
        AND period."AttendanceDate" = legacy."AttendanceDate"
        AND period.session_kind = 'SUBJECT'
    )
`;

/** Removes the retired whole-day attendance write model. */
export class RetireDailyAttendance20260826092000 implements MigrationInterface {
  name = 'RetireDailyAttendance20260826092000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A homeroom duty remains useful for roster ownership and case follow-up,
    // but it no longer grants a second whole-day attendance route. The actual
    // homeroom lesson is represented by its SUBJECT assignment and slot.
    await queryRunner.query(`
      UPDATE teacher_access_grants grant_row
      SET revoked_at = COALESCE(grant_row.revoked_at, now()),
          revocation_reason = COALESCE(
            grant_row.revocation_reason,
            'DAILY_ATTENDANCE_RETIRED'
          )
      FROM teacher_access_attendance_assignments scope
      JOIN classroom_teacher_assignments assignment
        ON assignment.id = scope.assignment_id
      WHERE scope.grant_id = grant_row.id
        AND assignment.assignment_kind = 'HOMEROOM'
        AND grant_row.revoked_at IS NULL
    `);
    await queryRunner.query(`
      DELETE FROM teacher_access_grant_capabilities
      WHERE capability = 'HOMEROOM_ATTENDANCE'
    `);
    await queryRunner.query(`
      DELETE FROM teacher_access_grant_assignments scope
      USING classroom_teacher_assignments assignment
      WHERE assignment.id = scope.assignment_id
        AND assignment.assignment_kind = 'HOMEROOM'
    `);
    await queryRunner.query(`
      ALTER TABLE teacher_access_grant_capabilities
      DROP CONSTRAINT IF EXISTS chk_teacher_access_grant_capability
    `);
    await queryRunner.query(`
      ALTER TABLE teacher_access_grant_capabilities
      ADD CONSTRAINT chk_teacher_access_grant_capability
      CHECK (capability IN ('SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'))
    `);

    const invalidSessions = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM attendance_sessions
      WHERE session_kind <> 'SUBJECT'
         OR subject_id IS NULL
         OR timetable_slot_id IS NULL
    `)) as Array<{ count: number }>;
    if (Number(invalidSessions[0]?.count ?? 0) > 0) {
      throw new Error(
        'RetireDailyAttendance: every retained session must be SUBJECT with subject_id and timetable_slot_id',
      );
    }
    const invalidMarks = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM attendance
      WHERE session_kind <> 'SUBJECT'
    `)) as Array<{ count: number }>;
    if (Number(invalidMarks[0]?.count ?? 0) > 0) {
      throw new Error('RetireDailyAttendance: every retained attendance row must be SUBJECT');
    }

    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(SUBJECT_ONLY_DAY_VIEW);

    await queryRunner.query(`DROP INDEX IF EXISTS uq_attendance_daily`);
    await queryRunner.query(
      `ALTER TABLE attendance ALTER COLUMN session_kind SET DEFAULT 'SUBJECT'`,
    );
    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_session_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_session_kind CHECK (session_kind = 'SUBJECT')
    `);

    await queryRunner.query(
      `ALTER TABLE attendance_sessions ALTER COLUMN session_kind SET DEFAULT 'SUBJECT'`,
    );
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD CONSTRAINT chk_attendance_sessions_kind CHECK (session_kind = 'SUBJECT')
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_subject_shape`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD CONSTRAINT chk_attendance_sessions_subject_shape
      CHECK (subject_id IS NOT NULL AND timetable_slot_id IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_grant_capabilities
      DROP CONSTRAINT IF EXISTS chk_teacher_access_grant_capability
    `);
    await queryRunner.query(`
      ALTER TABLE teacher_access_grant_capabilities
      ADD CONSTRAINT chk_teacher_access_grant_capability
      CHECK (capability IN ('HOMEROOM_ATTENDANCE', 'SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'))
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
    await queryRunner.query(
      `ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS chk_attendance_sessions_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
      ADD CONSTRAINT chk_attendance_sessions_kind
      CHECK (session_kind IN ('DAILY', 'SUBJECT'))
    `);
    await queryRunner.query(
      `ALTER TABLE attendance_sessions ALTER COLUMN session_kind SET DEFAULT 'DAILY'`,
    );

    await queryRunner.query(
      `ALTER TABLE attendance DROP CONSTRAINT IF EXISTS chk_attendance_session_kind`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance
      ADD CONSTRAINT chk_attendance_session_kind CHECK (session_kind IN ('DAILY', 'SUBJECT'))
    `);
    await queryRunner.query(`ALTER TABLE attendance ALTER COLUMN session_kind SET DEFAULT 'DAILY'`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_daily
      ON attendance (student_uuid, "AttendanceDate")
      WHERE session_kind = 'DAILY'
    `);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(SUBJECT_WITH_DAILY_FALLBACK_DAY_VIEW);
  }
}
