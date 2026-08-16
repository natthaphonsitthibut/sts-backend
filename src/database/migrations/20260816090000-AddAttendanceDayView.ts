import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per student per day, derived from the subject rounds that day.
 *
 * Attendance is taken per period, so "did this student come to school today"
 * was being answered twice: the risk engine derived it from the subject rounds
 * while the dashboard and the classroom screens read the separate DAILY round a
 * homeroom teacher may or may not have taken. This view is that answer, written
 * once, so every screen reports the same day.
 *
 * The verdict, in the order the CASE evaluates:
 *   ลา    — every recorded period is leave (leave is not a measurement)
 *   ขาด   — no period says present or late, i.e. the student never showed up
 *   สาย   — the student showed up but at least one period marked them late
 *   มา    — present in at least one period, none late
 *
 * Days that predate subject check-in keep their recorded DAILY row: the second
 * branch of the UNION fills in only where no subject round exists, so history
 * stays readable without migrating a single row.
 */
export class AddAttendanceDayView20260816090000 implements MigrationInterface {
  name = 'AddAttendanceDayView20260816090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW attendance_day AS
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

    // Same verdict, narrowed to one subject: the staff history can then show a
    // single subject and read the same numbers the teacher of that subject sees.
    await queryRunner.query(`
      CREATE OR REPLACE VIEW attendance_subject_day AS
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_subject_day;`);
    await queryRunner.query(`DROP VIEW IF EXISTS attendance_day;`);
  }
}
