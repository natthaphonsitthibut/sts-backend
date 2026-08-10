import type { MigrationInterface, QueryRunner } from 'typeorm';

const RECORDER_MARKER = 'SYSTEM:DEMO_RISK_DISTRIBUTION';
const CALENDAR_REASON = 'ข้อมูลสาธิตความเสี่ยงโรงเรียน showcase';
const TARGET_HIGH_RISK_PERCENT = 5;
const SCHOOL_NAME = 'โรงเรียนเทพศิรินทร์ราชดำริ';

/**
 * Builds a deterministic high-risk demo population only in the configured
 * showcase school when an active DEMO actor exists there. Existing attendance is
 * never replaced. Derived profiles are invalidated so the bounded synchronous
 * startup repair recalculates them through the canonical risk-profile query
 * before the application starts serving requests.
 */
export class SeedDemoRiskDistribution20260807160000 implements MigrationInterface {
  name = 'SeedDemoRiskDistribution20260807160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_demo_risk_distribution_student
        ON attendance (student_uuid)
        WHERE "RecordedBy" = 'SYSTEM:DEMO_RISK_DISTRIBUTION'
    `);

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
        active_terms AS MATERIALIZED (
          SELECT DISTINCT
            school_term.id AS school_term_id,
            school_term.school_id,
            school_term.academic_year,
            school_term.semester,
            school_term.starts_on,
            school_term.ends_on
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = enrollment.person_uuid
           AND current_enrollment.selected_student_uuid = enrollment.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          JOIN school_terms school_term ON school_term.id = enrollment.school_term_id
          JOIN schools school
            ON school.id = school_term.school_id
           AND school.name = $2
          WHERE enrollment.deleted_at IS NULL
            AND school_term.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM users demo_actor
              JOIN school_teacher_memberships demo_membership
                ON demo_membership.teacher_user_id = demo_actor.id
               AND demo_membership.school_id = school.id
               AND demo_membership.membership_status = 'ACTIVE'
               AND demo_membership.deleted_at IS NULL
              WHERE demo_actor.data_origin_code = 'DEMO'
                AND demo_actor.status = 'ACTIVE'
            )
        ),
        selected_dates AS (
          SELECT active_term.school_term_id, available_date.calendar_date
          FROM active_terms active_term
          CROSS JOIN risk_setting
          CROSS JOIN LATERAL (
            SELECT candidate_date::date AS calendar_date
            FROM GENERATE_SERIES(
              active_term.starts_on::timestamp,
              LEAST(
                COALESCE(active_term.ends_on, CURRENT_DATE - 1),
                CURRENT_DATE - 1
              )::timestamp,
              INTERVAL '1 day'
            ) candidate_date
            WHERE EXTRACT(ISODOW FROM candidate_date) BETWEEN 1 AND 5
              AND NOT EXISTS (
                SELECT 1
                FROM school_calendar_days existing_calendar
                WHERE existing_calendar.school_term_id = active_term.school_term_id
                  AND existing_calendar.calendar_date = candidate_date::date
              )
              AND NOT EXISTS (
                SELECT 1
                FROM attendance existing_attendance
                WHERE existing_attendance."SchoolID_Onec" = active_term.school_id
                  AND existing_attendance."AcademicYear_Onec" = active_term.academic_year
                  AND existing_attendance."Semester_Onec" = active_term.semester
                  AND existing_attendance."AttendanceDate" = candidate_date::date
              )
            ORDER BY candidate_date DESC
            LIMIT risk_setting.absence_threshold
          ) available_date
        )
        INSERT INTO school_calendar_days (
          school_term_id,
          calendar_date,
          day_type,
          reason,
          source
        )
        SELECT school_term_id, calendar_date, 'SCHOOL_DAY', $1, 'BACKFILL'
        FROM selected_dates
        ON CONFLICT (school_term_id, calendar_date) DO NOTHING
      `,
      [CALENDAR_REASON, SCHOOL_NAME],
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
        active_students AS MATERIALIZED (
          SELECT
            enrollment.student_uuid,
            enrollment."SchoolID_Onec" AS school_id,
            enrollment."GradeLevelID_Onec" AS grade_level_id,
            enrollment."RoomID_Onec" AS room_id,
            enrollment."AcademicYear_Onec" AS academic_year,
            enrollment."Semester_Onec" AS semester,
            enrollment.school_term_id
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = enrollment.person_uuid
           AND current_enrollment.selected_student_uuid = enrollment.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          JOIN schools school
            ON school.id = enrollment."SchoolID_Onec"
           AND school.name = $3
          WHERE enrollment.deleted_at IS NULL
            AND enrollment."SchoolID_Onec" IS NOT NULL
            AND enrollment.school_term_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM users demo_actor
              JOIN school_teacher_memberships demo_membership
                ON demo_membership.teacher_user_id = demo_actor.id
               AND demo_membership.school_id = school.id
               AND demo_membership.membership_status = 'ACTIVE'
               AND demo_membership.deleted_at IS NULL
              WHERE demo_actor.data_origin_code = 'DEMO'
                AND demo_actor.status = 'ACTIVE'
            )
        ),
        school_targets AS (
          SELECT
            school_id,
            GREATEST(
              1,
              CEIL(COUNT(*)::numeric * $2::numeric / 100)::int
            ) AS target_high_count
          FROM active_students
          GROUP BY school_id
        ),
        marker_high_students AS (
          SELECT attendance_record.student_uuid
          FROM attendance attendance_record
          CROSS JOIN risk_setting
          WHERE attendance_record."RecordedBy" IN (
            'SYSTEM:THEPSIRIN_RISK_SHOWCASE',
            $1
          )
            AND attendance_record.session_kind = 'DAILY'
            AND attendance_record."AttendanceStatus" = 2
          GROUP BY attendance_record.student_uuid, risk_setting.absence_threshold
          HAVING COUNT(DISTINCT attendance_record."AttendanceDate")
            >= risk_setting.absence_threshold
        ),
        existing_high_students AS MATERIALIZED (
          SELECT student.student_uuid, student.school_id
          FROM active_students student
          LEFT JOIN student_risk_profiles profile
            ON profile.student_uuid = student.student_uuid
          LEFT JOIN marker_high_students marker
            ON marker.student_uuid = student.student_uuid
          WHERE profile.risk_tier = 'HIGH'
             OR marker.student_uuid IS NOT NULL
        ),
        existing_high_counts AS (
          SELECT school_id, COUNT(*)::int AS high_count
          FROM existing_high_students
          GROUP BY school_id
        ),
        eligible_candidates AS MATERIALIZED (
          SELECT
            student.*,
            available_days.attendance_dates
          FROM active_students student
          CROSS JOIN risk_setting
          LEFT JOIN existing_high_students existing_high
            ON existing_high.student_uuid = student.student_uuid
          CROSS JOIN LATERAL (
            SELECT ARRAY_AGG(candidate_day.calendar_date ORDER BY candidate_day.calendar_date DESC)
              AS attendance_dates
            FROM (
              SELECT calendar_day.calendar_date
              FROM school_calendar_days calendar_day
              JOIN school_terms school_term
                ON school_term.id = calendar_day.school_term_id
              WHERE calendar_day.school_term_id = student.school_term_id
                AND calendar_day.day_type = 'SCHOOL_DAY'
                AND calendar_day.deleted_at IS NULL
                AND calendar_day.calendar_date <= LEAST(
                  COALESCE(school_term.ends_on, CURRENT_DATE - 1),
                  CURRENT_DATE - 1
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM attendance existing_attendance
                  WHERE existing_attendance.student_uuid = student.student_uuid
                    AND existing_attendance."AttendanceDate" = calendar_day.calendar_date
                    AND existing_attendance.session_kind IN ('DAILY', 'SUBJECT')
                )
              ORDER BY calendar_day.calendar_date DESC
              LIMIT risk_setting.absence_threshold
            ) candidate_day
          ) available_days
          WHERE existing_high.student_uuid IS NULL
            AND CARDINALITY(available_days.attendance_dates) = risk_setting.absence_threshold
        ),
        ranked_candidates AS (
          SELECT
            candidate.*,
            ROW_NUMBER() OVER (
              PARTITION BY candidate.school_id
              ORDER BY MD5(candidate.student_uuid::text), candidate.student_uuid
            ) AS candidate_rank
          FROM eligible_candidates candidate
        ),
        selected_students AS MATERIALIZED (
          SELECT candidate.*
          FROM ranked_candidates candidate
          JOIN school_targets target ON target.school_id = candidate.school_id
          LEFT JOIN existing_high_counts existing ON existing.school_id = candidate.school_id
          WHERE candidate.candidate_rank
            <= GREATEST(target.target_high_count - COALESCE(existing.high_count, 0), 0)
        ),
        inserted_attendance AS (
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
            student.student_uuid,
            student.school_id,
            student.grade_level_id,
            student.room_id,
            student.academic_year,
            student.semester,
            attendance_date,
            1,
            'DAILY',
            2,
            now(),
            $1
          FROM selected_students student
          CROSS JOIN LATERAL UNNEST(student.attendance_dates) AS seeded_day(attendance_date)
          ON CONFLICT (student_uuid, "AttendanceDate")
            WHERE session_kind = 'DAILY'
          DO NOTHING
          RETURNING student_uuid
        ),
        affected_students AS (
          SELECT DISTINCT student_uuid
          FROM inserted_attendance
        )
        DELETE FROM student_risk_profiles profile
        USING affected_students student
        WHERE profile.student_uuid = student.student_uuid
      `,
      [RECORDER_MARKER, TARGET_HIGH_RISK_PERCENT, SCHOOL_NAME],
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
    await queryRunner.query(
      `
        DELETE FROM school_calendar_days calendar_day
        USING school_terms school_term
        WHERE calendar_day.school_term_id = school_term.id
          AND calendar_day.reason = $1
          AND calendar_day.source = 'BACKFILL'
          AND NOT EXISTS (
            SELECT 1
            FROM attendance existing_attendance
            WHERE existing_attendance."SchoolID_Onec" = school_term.school_id
              AND existing_attendance."AcademicYear_Onec" = school_term.academic_year
              AND existing_attendance."Semester_Onec" = school_term.semester
              AND existing_attendance."AttendanceDate" = calendar_day.calendar_date
          )
      `,
      [CALENDAR_REASON],
    );
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_attendance_demo_risk_distribution_student
    `);
  }
}
