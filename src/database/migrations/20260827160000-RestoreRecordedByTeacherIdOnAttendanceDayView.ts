import type { MigrationInterface, QueryRunner } from 'typeorm';

const VIEW_WITH_RECORDER = `
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
    COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods,
    (ARRAY_AGG(
      period.recorded_by_teacher_id ORDER BY period."Period" NULLS LAST, period."AttendanceID"
    ))[1] AS recorded_by_teacher_id
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

const VIEW_WITHOUT_RECORDER = `
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

/**
 * `RetireDailyAttendance` (20260826092000) dropped and rebuilt `attendance_day`
 * to drop the UNION with the retired daily leg, but copied the pre-
 * `PointTeacherIdentityAtTeachers` column list and lost `recorded_by_teacher_id`
 * in the process — the classroom attendance-history screen reads this view, not
 * the table, so it started failing with "column does not exist".
 */
export class RestoreRecordedByTeacherIdOnAttendanceDayView20260827160000 implements MigrationInterface {
  name = 'RestoreRecordedByTeacherIdOnAttendanceDayView20260827160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(VIEW_WITH_RECORDER);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);
    await queryRunner.query(VIEW_WITHOUT_RECORDER);
  }
}
