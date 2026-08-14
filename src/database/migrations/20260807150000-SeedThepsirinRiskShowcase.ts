import type { MigrationInterface, QueryRunner } from 'typeorm';

const SCHOOL_NAME = 'โรงเรียนเทพศิรินทร์ราชดำริ';
const DEMO_REASON = 'ข้อมูลสาธิตสำหรับการนำเสนอวงจรติดตามนักเรียน';
const RECORDER_MARKER = 'SYSTEM:THEPSIRIN_RISK_SHOWCASE';

/**
 * Adds source attendance for the existing showcase cases, then invalidates
 * only their derived profiles. App startup uses the canonical risk-profile
 * recalculation to rebuild the card, ranking and student metrics consistently.
 */
export class SeedThepsirinRiskShowcase20260807150000 implements MigrationInterface {
  name = 'SeedThepsirinRiskShowcase20260807150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        WITH risk_setting AS (
          SELECT COALESCE(
            MAX(
              CASE
                WHEN setting_value ~ '^[1-9][0-9]*$' THEN setting_value::int
                ELSE NULL
              END
            ),
            3
          )::int AS absence_threshold
          FROM system_settings
          WHERE setting_key = 'CASE_RISK_HIGH_ABSENCE_DAYS'
        ),
        showcase_students AS (
          SELECT DISTINCT
            enrollment.student_uuid,
            enrollment."SchoolID_Onec" AS school_id,
            enrollment."GradeLevelID_Onec" AS grade_level_id,
            enrollment."RoomID_Onec" AS room_id,
            enrollment."AcademicYear_Onec" AS academic_year,
            enrollment."Semester_Onec" AS semester,
            enrollment.school_term_id
          FROM cases tracked_case
          JOIN schools school
            ON school.id = tracked_case.school_id
           AND school.name = $2
          JOIN student_term enrollment
            ON enrollment.student_uuid = tracked_case.student_uuid
           AND enrollment.deleted_at IS NULL
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = enrollment.person_uuid
           AND current_enrollment.selected_student_uuid = enrollment.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          WHERE tracked_case.reason_flagged = $1
            AND tracked_case.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM users demo_actor
              JOIN school_teacher_memberships demo_membership
                ON demo_membership.teacher_user_id = demo_actor.id
               AND demo_membership.school_id = tracked_case.school_id
               AND demo_membership.membership_status = 'ACTIVE'
               AND demo_membership.deleted_at IS NULL
              WHERE demo_actor.data_origin_code = 'DEMO'
                AND demo_actor.status = 'ACTIVE'
            )
        ),
        candidate_days AS (
          SELECT
            student.*,
            risk_setting.absence_threshold,
            school_day.calendar_date,
            COUNT(*) OVER (PARTITION BY student.student_uuid)::int AS available_day_count
          FROM showcase_students student
          CROSS JOIN risk_setting
          CROSS JOIN LATERAL (
            SELECT calendar_day.calendar_date
            FROM school_calendar_days calendar_day
            JOIN school_terms school_term
              ON school_term.id = calendar_day.school_term_id
            WHERE calendar_day.school_term_id = student.school_term_id
              AND calendar_day.day_type = 'SCHOOL_DAY'
              AND calendar_day.deleted_at IS NULL
              AND calendar_day.calendar_date <= LEAST(school_term.ends_on, CURRENT_DATE - 1)
              AND NOT EXISTS (
                SELECT 1
                FROM attendance existing_attendance
                WHERE existing_attendance.student_uuid = student.student_uuid
                  AND existing_attendance."AttendanceDate" = calendar_day.calendar_date
                  AND existing_attendance.session_kind IN ('DAILY', 'SUBJECT')
              )
            ORDER BY calendar_day.calendar_date DESC
            LIMIT risk_setting.absence_threshold
          ) school_day
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
          "RecordedBy"
        )
        SELECT
          student_uuid,
          school_id,
          grade_level_id,
          room_id,
          academic_year,
          semester,
          calendar_date,
          1,
          'DAILY',
          2,
          now(),
          $3
        FROM candidate_days
        WHERE available_day_count = absence_threshold
        ON CONFLICT (student_uuid, "AttendanceDate")
          WHERE session_kind = 'DAILY'
        DO NOTHING
      `,
      [DEMO_REASON, SCHOOL_NAME, RECORDER_MARKER],
    );

    await queryRunner.query(
      `
        WITH risk_setting AS (
          SELECT COALESCE(
            MAX(
              CASE
                WHEN setting_value ~ '^[1-9][0-9]*$' THEN setting_value::int
                ELSE NULL
              END
            ),
            3
          )::int AS absence_threshold
          FROM system_settings
          WHERE setting_key = 'CASE_RISK_HIGH_ABSENCE_DAYS'
        ),
        qualified_students AS (
          SELECT attendance_record.student_uuid
          FROM attendance attendance_record
          CROSS JOIN risk_setting
          WHERE attendance_record."RecordedBy" = $1
            AND attendance_record.session_kind = 'DAILY'
            AND attendance_record."AttendanceStatus" = 2
          GROUP BY attendance_record.student_uuid, risk_setting.absence_threshold
          HAVING COUNT(DISTINCT attendance_record."AttendanceDate") >= risk_setting.absence_threshold
        )
        DELETE FROM student_risk_profiles profile
        USING qualified_students student
        WHERE profile.student_uuid = student.student_uuid
      `,
      [RECORDER_MARKER],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        WITH affected_students AS MATERIALIZED (
          SELECT DISTINCT student_uuid
          FROM attendance
          WHERE "RecordedBy" = $1
        ),
        deleted_attendance AS (
          DELETE FROM attendance
          WHERE "RecordedBy" = $1
          RETURNING student_uuid
        )
        DELETE FROM student_risk_profiles profile
        USING affected_students student
        WHERE profile.student_uuid = student.student_uuid
      `,
      [RECORDER_MARKER],
    );
  }
}
