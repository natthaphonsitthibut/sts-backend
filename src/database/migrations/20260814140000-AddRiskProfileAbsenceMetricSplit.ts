import type { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_DESCRIPTION =
  'จำนวนวันขาดเรียนหลังปิดเคสล่าสุด (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น';
const PREVIOUS_DESCRIPTION =
  'จำนวนวันขาดเรียนสะสม (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น';

/** Separates whole-term attendance history from the post-resolution risk window. */
export class AddRiskProfileAbsenceMetricSplit20260814140000 implements MigrationInterface {
  name = 'AddRiskProfileAbsenceMetricSplit20260814140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Preserve every derived field whose meaning changes so down() can restore
    // the exact pre-migration profile state instead of approximating it.
    await queryRunner.query(`
      CREATE TABLE risk_profile_absence_metric_split_backup_20260814 AS
      SELECT
        student_uuid, consecutive_absent_days, absent_days, late_count,
        school_day_count, weighted_absence_days, weighted_attendance_percent,
        risk_tier, risk_severity, risk_score, profile_calculated_at, updated_at
      FROM student_risk_profiles
    `);
    await queryRunner.query(`
      CREATE TABLE risk_profile_absence_setting_backup_20260814 AS
      SELECT setting_key, description
      FROM system_settings
      WHERE setting_key = 'CASE_RISK_HIGH_ABSENCE_DAYS'
    `);

    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        ADD COLUMN term_absent_days INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN absence_reset_after_date DATE NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_term_absent_days
          CHECK (term_absent_days >= 0)
    `);

    // Backfill every affected derived metric in the same transaction. Without
    // this, absent_days and risk_tier would keep their old whole-term meaning
    // until a separate runtime job happened to recalculate the student.
    await queryRunner.query(`
      WITH profile_terms AS (
        SELECT
          profile.student_uuid,
          profile.academic_year,
          profile.semester,
          profile.school_day_count,
          enrollment.person_uuid
        FROM student_risk_profiles profile
        JOIN student_term enrollment ON enrollment.student_uuid = profile.student_uuid
      ), case_completion_baselines AS (
        SELECT
          profile.student_uuid,
          MAX(COALESCE(latest_review.reviewed_at, tracked_case.updated_at))::date
            AS reset_after_date
        FROM profile_terms profile
        JOIN cases tracked_case
          ON tracked_case.student_uuid = profile.student_uuid
         AND tracked_case.status = 'RESOLVED'
         AND tracked_case.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT review.reviewed_at
          FROM case_reviews review
          WHERE review.case_id = tracked_case.id
          ORDER BY review.reviewed_at DESC, review.id DESC
          LIMIT 1
        ) latest_review ON TRUE
        GROUP BY profile.student_uuid
      ), classified_term_days AS (
        SELECT
          attendance.student_uuid,
          attendance."AttendanceDate"::date AS attendance_date,
          (
            COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
            AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
          ) AS is_absent_day,
          COUNT(*) FILTER (WHERE attendance."AttendanceStatus" = 3)::int AS late_records
        FROM attendance
        JOIN profile_terms profile
          ON profile.student_uuid = attendance.student_uuid
         AND profile.academic_year = attendance."AcademicYear_Onec"
         AND profile.semester = attendance."Semester_Onec"
        WHERE attendance.session_kind = 'SUBJECT'
        GROUP BY attendance.student_uuid, attendance."AttendanceDate"
      ), operational_days AS (
        SELECT term_day.*
        FROM classified_term_days term_day
        LEFT JOIN case_completion_baselines baseline
          ON baseline.student_uuid = term_day.student_uuid
        WHERE term_day.attendance_date > COALESCE(baseline.reset_after_date, '-infinity'::date)
      ), ranked_operational_days AS (
        SELECT
          student_uuid,
          is_absent_day,
          ROW_NUMBER() OVER (PARTITION BY student_uuid ORDER BY attendance_date DESC) AS rn
        FROM operational_days
      ), streak_boundaries AS (
        SELECT
          student_uuid,
          rn,
          is_absent_day,
          MIN(CASE WHEN NOT is_absent_day THEN rn END)
            OVER (PARTITION BY student_uuid) AS first_non_absent_rn
        FROM ranked_operational_days
      ), absence_streak AS (
        SELECT student_uuid, COUNT(*)::int AS consecutive_absent_days
        FROM streak_boundaries
        WHERE is_absent_day
          AND (first_non_absent_rn IS NULL OR rn < first_non_absent_rn)
        GROUP BY student_uuid
      ), operational_summary AS (
        SELECT
          student_uuid,
          COUNT(*) FILTER (WHERE is_absent_day)::int AS absent_days,
          COALESCE(SUM(late_records), 0)::int AS late_count,
          COUNT(*)::int AS recorded_day_count
        FROM operational_days
        GROUP BY student_uuid
      ), term_summary AS (
        SELECT
          student_uuid,
          COUNT(*) FILTER (WHERE is_absent_day)::int AS term_absent_days
        FROM classified_term_days
        GROUP BY student_uuid
      ), teacher_signal_events AS (
        SELECT comment.person_uuid
        FROM classroom_student_comments comment
        UNION ALL
        SELECT enrollment.person_uuid
        FROM student_observations observation
        JOIN student_term enrollment ON enrollment.student_uuid = observation.student_uuid
        WHERE observation.deleted_at IS NULL
      ), teacher_signal_summary AS (
        SELECT profile.student_uuid, COUNT(*)::int AS teacher_signal_count
        FROM profile_terms profile
        JOIN teacher_signal_events signal ON signal.person_uuid = profile.person_uuid
        GROUP BY profile.student_uuid
      ), threshold AS (
        SELECT COALESCE(
          (
            SELECT CASE
              WHEN setting_value ~ '^[1-9][0-9]*$' THEN setting_value::int
              ELSE 3
            END
            FROM system_settings
            WHERE setting_key = 'CASE_RISK_HIGH_ABSENCE_DAYS'
          ),
          3
        ) AS high_absence_days
      ), metrics AS (
        SELECT
          profile.student_uuid,
          COALESCE(streak.consecutive_absent_days, 0)::int AS consecutive_absent_days,
          COALESCE(operational.absent_days, 0)::int AS absent_days,
          COALESCE(term.term_absent_days, 0)::int AS term_absent_days,
          baseline.reset_after_date,
          COALESCE(operational.late_count, 0)::int AS late_count,
          COALESCE(
            NULLIF(profile.school_day_count, 0),
            operational.recorded_day_count,
            0
          )::int AS effective_school_day_count,
          COALESCE(signal.teacher_signal_count, 0)::int AS teacher_signal_count,
          threshold.high_absence_days
        FROM profile_terms profile
        CROSS JOIN threshold
        LEFT JOIN case_completion_baselines baseline
          ON baseline.student_uuid = profile.student_uuid
        LEFT JOIN absence_streak streak ON streak.student_uuid = profile.student_uuid
        LEFT JOIN operational_summary operational
          ON operational.student_uuid = profile.student_uuid
        LEFT JOIN term_summary term ON term.student_uuid = profile.student_uuid
        LEFT JOIN teacher_signal_summary signal ON signal.student_uuid = profile.student_uuid
      ), scored AS (
        SELECT
          metrics.*,
          CASE
            WHEN absent_days >= high_absence_days THEN 'HIGH'
            WHEN teacher_signal_count > 0 THEN 'WATCH'
            ELSE 'NORMAL'
          END AS risk_tier,
          CASE
            WHEN absent_days >= high_absence_days THEN 2
            WHEN teacher_signal_count > 0 THEN 1
            ELSE 0
          END AS risk_severity,
          absent_days::numeric / high_absence_days::numeric AS risk_score,
          CASE
            WHEN effective_school_day_count > 0 THEN ROUND(
              GREATEST(0, effective_school_day_count - absent_days)::numeric
              * 100 / effective_school_day_count::numeric,
              1
            )
            ELSE NULL
          END AS weighted_attendance_percent
        FROM metrics
      )
      UPDATE student_risk_profiles profile
      SET
        consecutive_absent_days = scored.consecutive_absent_days,
        absent_days = scored.absent_days,
        term_absent_days = scored.term_absent_days,
        absence_reset_after_date = scored.reset_after_date,
        late_count = scored.late_count,
        school_day_count = scored.effective_school_day_count,
        weighted_absence_days = scored.absent_days,
        weighted_attendance_percent = scored.weighted_attendance_percent,
        risk_tier = scored.risk_tier,
        risk_severity = scored.risk_severity,
        risk_score = ROUND(scored.risk_score, 4),
        profile_calculated_at = now(),
        updated_at = now()
      FROM scored
      WHERE scored.student_uuid = profile.student_uuid
    `);
    await queryRunner.query(
      `
      UPDATE system_settings
      SET description = $2
      WHERE setting_key = $1
    `,
      ['CASE_RISK_HIGH_ABSENCE_DAYS', NEW_DESCRIPTION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE student_risk_profiles profile
      SET
        consecutive_absent_days = backup.consecutive_absent_days,
        absent_days = backup.absent_days,
        late_count = backup.late_count,
        school_day_count = backup.school_day_count,
        weighted_absence_days = backup.weighted_absence_days,
        weighted_attendance_percent = backup.weighted_attendance_percent,
        risk_tier = backup.risk_tier,
        risk_severity = backup.risk_severity,
        risk_score = backup.risk_score,
        profile_calculated_at = backup.profile_calculated_at,
        updated_at = backup.updated_at
      FROM risk_profile_absence_metric_split_backup_20260814 backup
      WHERE backup.student_uuid = profile.student_uuid
    `);
    await queryRunner.query(`
      UPDATE system_settings setting
      SET description = backup.description
      FROM risk_profile_absence_setting_backup_20260814 backup
      WHERE backup.setting_key = setting.setting_key
    `);
    await queryRunner.query(
      `
      UPDATE system_settings
      SET description = $2
      WHERE setting_key = $1
        AND NOT EXISTS (
          SELECT 1
          FROM risk_profile_absence_setting_backup_20260814 backup
          WHERE backup.setting_key = $1
        )
    `,
      ['CASE_RISK_HIGH_ABSENCE_DAYS', PREVIOUS_DESCRIPTION],
    );
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_term_absent_days,
        DROP COLUMN IF EXISTS absence_reset_after_date,
        DROP COLUMN IF EXISTS term_absent_days
    `);
    await queryRunner.query(`DROP TABLE risk_profile_absence_metric_split_backup_20260814`);
    await queryRunner.query(`DROP TABLE risk_profile_absence_setting_backup_20260814`);
  }
}
