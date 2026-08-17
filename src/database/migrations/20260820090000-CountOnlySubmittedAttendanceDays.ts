import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two corrections to the day views introduced in 20260816090000.
 *
 * 1. **A draft is not attendance.** Autosave writes every tap straight into
 *    `attendance` while the round stays `OPEN`, so a teacher who marked five
 *    students and closed the tab already showed up in ประวัติ, in the dashboard
 *    chart and — worse — in the risk engine, which could open an absence case
 *    off a round nobody submitted. The views now count a row only once its
 *    round is `SUBMITTED` (or `REOPENED`, which is a submitted round being
 *    corrected). The check-in screen prefills from the `attendance` table
 *    directly, so drafts still survive leaving and reopening the page — only
 *    the reporting side waits for the submit.
 *
 *    Rows with no session at all are kept: those predate attendance_sessions,
 *    and dropping them would erase imported history instead of hiding a draft.
 *
 * 2. **Columns nothing reads.** `absent_periods`, `recorded_periods`,
 *    `source_kind` and `SchoolID_Onec` had no reader in the codebase, and
 *    `attendance_subject_day.source_kind` was the constant `'SUBJECT'`.
 *    `late_periods` stays — the risk repository reads it.
 *
 * A view cannot drop a column through `CREATE OR REPLACE`, so both are dropped
 * and recreated; `down()` restores the previous definitions verbatim.
 */
export class CountOnlySubmittedAttendanceDays20260820090000 implements MigrationInterface {
  name = 'CountOnlySubmittedAttendanceDays20260820090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);

    await queryRunner.query(`
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
        );
    `);

    await queryRunner.query(`
      CREATE VIEW attendance_subject_day AS
      SELECT
        (ARRAY_AGG(
          period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "AttendanceID",
        period.student_uuid,
        period."AttendanceDate"::date AS "AttendanceDate",
        period."AcademicYear_Onec" AS "AcademicYear_Onec",
        period."Semester_Onec" AS "Semester_Onec",
        session.subject_id,
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
      JOIN attendance_sessions session ON session.id = period.session_id
      WHERE period.session_kind = 'SUBJECT'
        AND session.deleted_at IS NULL
        AND session.subject_id IS NOT NULL
        AND session.status IN ('SUBMITTED', 'REOPENED')
      GROUP BY
        period.student_uuid,
        period."AttendanceDate",
        period."AcademicYear_Onec",
        period."Semester_Onec",
        session.subject_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day`);

    await queryRunner.query(`
      CREATE VIEW attendance_day AS
      SELECT
        subject_day.attendance_id AS "AttendanceID",
        subject_day.student_uuid,
        subject_day.attendance_date AS "AttendanceDate",
        subject_day.academic_year AS "AcademicYear_Onec",
        subject_day.semester AS "Semester_Onec",
        subject_day.school_id AS "SchoolID_Onec",
        subject_day.status AS "AttendanceStatus",
        subject_day.recorded_by AS "RecordedBy",
        subject_day.recorded_at AS "RecordedAt",
        subject_day.late_periods,
        subject_day.absent_periods,
        subject_day.recorded_periods,
        'SUBJECT'::text AS source_kind
      FROM (
        SELECT
          (ARRAY_AGG(
            period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
          ))[1] AS attendance_id,
          period.student_uuid,
          period."AttendanceDate"::date AS attendance_date,
          period."AcademicYear_Onec" AS academic_year,
          period."Semester_Onec" AS semester,
          MIN(period."SchoolID_Onec") AS school_id,
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
          COUNT(*) FILTER (WHERE period."AttendanceStatus" = 3)::int AS late_periods,
          COUNT(*) FILTER (WHERE period."AttendanceStatus" = 2)::int AS absent_periods,
          COUNT(*)::int AS recorded_periods
        FROM attendance period
        WHERE period.session_kind = 'SUBJECT'
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
        legacy."SchoolID_Onec",
        legacy."AttendanceStatus",
        legacy."RecordedBy",
        legacy."RecordedAt",
        CASE WHEN legacy."AttendanceStatus" = 3 THEN 1 ELSE 0 END,
        CASE WHEN legacy."AttendanceStatus" = 2 THEN 1 ELSE 0 END,
        1,
        'DAILY'::text
      FROM attendance legacy
      WHERE legacy.session_kind = 'DAILY'
        AND NOT EXISTS (
          SELECT 1
          FROM attendance period
          WHERE period.student_uuid = legacy.student_uuid
            AND period."AttendanceDate" = legacy."AttendanceDate"
            AND period.session_kind = 'SUBJECT'
        );
    `);

    await queryRunner.query(`
      CREATE VIEW attendance_subject_day AS
      SELECT
        (ARRAY_AGG(
          period."AttendanceID" ORDER BY period."Period" NULLS LAST, period."AttendanceID"
        ))[1] AS "AttendanceID",
        period.student_uuid,
        period."AttendanceDate"::date AS "AttendanceDate",
        period."AcademicYear_Onec" AS "AcademicYear_Onec",
        period."Semester_Onec" AS "Semester_Onec",
        MIN(period."SchoolID_Onec") AS "SchoolID_Onec",
        session.subject_id,
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
        COUNT(*) FILTER (WHERE period."AttendanceStatus" = 2)::int AS absent_periods,
        COUNT(*)::int AS recorded_periods,
        'SUBJECT'::text AS source_kind
      FROM attendance period
      JOIN attendance_sessions session ON session.id = period.session_id
      WHERE period.session_kind = 'SUBJECT'
        AND session.deleted_at IS NULL
        AND session.subject_id IS NOT NULL
      GROUP BY
        period.student_uuid,
        period."AttendanceDate",
        period."AcademicYear_Onec",
        period."Semester_Onec",
        session.subject_id;
    `);
  }
}
