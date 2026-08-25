import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { RiskDashboardThresholds } from '../task/task.types';

interface CountRow extends Record<string, unknown> {
  count: number | string;
}

interface UpsertCountRow extends Record<string, unknown> {
  evaluated: number | string;
  changed: number | string;
}

/** How many profiles a recalculation looked at vs actually had to rewrite. */
export interface RiskRecalculationResult {
  evaluated: number;
  changed: number;
  skipped: number;
}

const DEFAULT_RISK_PROFILE_THRESHOLDS: RiskDashboardThresholds = {
  highAbsentDays: 3,
};

@Injectable()
export class RiskProfileRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Loads every risk threshold in one round trip instead of one query per key. */
  private async getRiskSettingValues(keys: string[]): Promise<Map<string, string>> {
    const result = await queryDataSource<{ setting_key: string; setting_value: string }>(
      this.dataSource,
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key = ANY($1::text[])`,
      [keys],
    );
    return new Map(result.rows.map((row) => [row.setting_key, row.setting_value]));
  }

  async getRiskThresholds(): Promise<RiskDashboardThresholds> {
    const values = await this.getRiskSettingValues(['CASE_RISK_HIGH_ABSENCE_DAYS']);
    return {
      highAbsentDays: this.parsePositiveInteger(
        values.get('CASE_RISK_HIGH_ABSENCE_DAYS') ?? null,
        DEFAULT_RISK_PROFILE_THRESHOLDS.highAbsentDays,
      ),
    };
  }

  async recalculateStudents(
    studentUuids: string[],
    thresholds: RiskDashboardThresholds,
  ): Promise<RiskRecalculationResult> {
    const uniqueStudentUuids = [
      ...new Set(studentUuids.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueStudentUuids.length === 0) {
      return { evaluated: 0, changed: 0, skipped: 0 };
    }
    return await this.upsertProfiles(thresholds, 'WHERE s.student_uuid = ANY($2::uuid[])', [
      uniqueStudentUuids,
    ]);
  }

  async recalculateAll(thresholds: RiskDashboardThresholds): Promise<RiskRecalculationResult> {
    return await this.upsertProfiles(thresholds, '', []);
  }

  async countMissingActiveProfiles(): Promise<number> {
    const result = await queryDataSource<CountRow>(
      this.dataSource,
      `
        SELECT COUNT(*)::int AS count
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        WHERE profile.student_uuid IS NULL
      `,
    );
    return Number.parseInt(String(result.rows[0]?.count ?? '0'), 10);
  }

  /**
   * Active enrollments that have no profile row yet, capped so startup repair and
   * reconciliation stay bounded instead of scanning/rewriting the whole table.
   */
  async listMissingActiveProfileStudentUuids(limit: number): Promise<string[]> {
    const result = await queryDataSource<{ student_uuid: string }>(
      this.dataSource,
      `
        SELECT s.student_uuid::text
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        WHERE profile.student_uuid IS NULL
        ORDER BY s.student_uuid
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map((row) => row.student_uuid);
  }

  private parsePositiveInteger(value: string | null, fallback: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async upsertProfiles(
    thresholds: RiskDashboardThresholds,
    selectedWhereSql: string,
    extraParams: unknown[],
  ): Promise<RiskRecalculationResult> {
    const params: unknown[] = [thresholds.highAbsentDays, ...extraParams];
    const result = await queryDataSource<UpsertCountRow>(
      this.dataSource,
      `
        WITH selected_students AS (
          SELECT
            s.student_uuid,
            s.person_uuid,
            s."AcademicYear_Onec" AS academic_year,
            s."Semester_Onec" AS semester,
            s."SchoolID_Onec" AS school_id,
            s."GradeLevelID_Onec" AS grade_level_id,
            s."RoomID_Onec" AS room_id
          FROM student_term s
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = s.person_uuid
           AND current_enrollment.selected_student_uuid = s.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          ${selectedWhereSql}
        ), case_completion_baselines AS (
          SELECT
            s.student_uuid,
            MAX(COALESCE(latest_review.reviewed_at, tracked_case.updated_at))::date
              AS reset_after_date
          FROM selected_students s
          JOIN cases tracked_case
            ON tracked_case.student_uuid = s.student_uuid
           AND tracked_case.status = 'RESOLVED'
           AND tracked_case.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT review.reviewed_at
            FROM case_reviews review
            WHERE review.case_id = tracked_case.id
            ORDER BY review.reviewed_at DESC, review.id DESC
            LIMIT 1
          ) latest_review ON TRUE
          GROUP BY s.student_uuid
        ),
        -- Subject-period records form one day verdict: ลา (status 4) is not
        -- measured, มา/สาย both count as attended, and the day is ขาด only
        -- when every measured period is unattended.
        classified_term_days AS (
          SELECT
            day.student_uuid,
            day."AttendanceDate" AS attendance_date,
            day.late_periods AS late_records,
            (day."AttendanceStatus" = 2) AS is_absent_day
          FROM attendance_day day
          JOIN selected_students s ON s.student_uuid = day.student_uuid
          WHERE day."AcademicYear_Onec" = s.academic_year
            AND day."Semester_Onec" = s.semester
        ),
        -- Keep the whole-term history independent from the operational reset.
        -- The post-case view uses the same day verdict, only with a date boundary.
        classified_days AS (
          SELECT term_days.*
          FROM classified_term_days term_days
          LEFT JOIN case_completion_baselines baseline
            ON baseline.student_uuid = term_days.student_uuid
          WHERE term_days.attendance_date > COALESCE(baseline.reset_after_date, '-infinity'::date)
        ),
        ranked_attendance_days AS (
          SELECT
            student_uuid,
            attendance_date,
            is_absent_day,
            ROW_NUMBER() OVER (PARTITION BY student_uuid ORDER BY attendance_date DESC) AS rn
          FROM classified_days
        ),
        streak_boundaries AS (
          SELECT
            student_uuid,
            rn,
            is_absent_day,
            MIN(CASE WHEN NOT is_absent_day THEN rn END) OVER (PARTITION BY student_uuid)
              AS first_non_absent_rn
          FROM ranked_attendance_days
        ),
        absence_streak AS (
          SELECT student_uuid, COUNT(*)::int AS consecutive_absent_days
          FROM streak_boundaries
          WHERE is_absent_day
            AND (first_non_absent_rn IS NULL OR rn < first_non_absent_rn)
          GROUP BY student_uuid
        ),
        attendance_summary AS (
          SELECT
            student_uuid,
            COUNT(*) FILTER (WHERE is_absent_day)::int AS absent_days_since_case_reset,
            COALESCE(SUM(late_records), 0)::int AS late_count,
            COUNT(*)::int AS recorded_day_count,
            MAX(attendance_date)::timestamptz AS latest_attendance_at
          FROM classified_days
          GROUP BY student_uuid
        ),
        term_attendance_summary AS (
          SELECT
            student_uuid,
            COUNT(*) FILTER (WHERE is_absent_day)::int AS term_absent_days
          FROM classified_term_days
          GROUP BY student_uuid
        ),
        -- Kept as a reported metric only; late periods no longer move the tier.
        subject_late_summary AS (
          SELECT
            a.student_uuid,
            COUNT(*)::int AS subject_late_count,
            MAX(a."AttendanceDate")::timestamptz AS latest_subject_late_at
          FROM attendance_effective_records a
          JOIN selected_students s ON s.student_uuid = a.student_uuid
          JOIN attendance_sessions sess ON sess.id = a.session_id
          WHERE a."AcademicYear_Onec" = s.academic_year
            AND a."Semester_Onec" = s.semester
            AND a.session_kind = 'SUBJECT'
            AND a."AttendanceStatus" = 3
            AND sess.session_kind = 'SUBJECT'
            AND sess.status = 'SUBMITTED'
            AND sess.deleted_at IS NULL
          GROUP BY a.student_uuid
        ),
        teacher_signal_events AS (
          SELECT comment.person_uuid, comment.created_at
          FROM classroom_student_comments comment
          WHERE comment.concern_level_code IN ('WATCH', 'CONCERN')
        ),
        -- เฝ้าระวัง comes from the teacher comments a student carries across terms.
        teacher_signal_summary AS (
          SELECT
            s.student_uuid,
            COUNT(*)::int AS teacher_signal_count,
            MAX(signal.created_at) AS latest_signal_at
          FROM selected_students s
          JOIN teacher_signal_events signal ON signal.person_uuid = s.person_uuid
          GROUP BY s.student_uuid
        ),
        calendar_counts AS (
          SELECT
            s.student_uuid,
            COUNT(cd.id)::int AS school_day_count
          FROM selected_students s
          JOIN school_terms st
            ON st.school_id = s.school_id
           AND st.academic_year = s.academic_year
           AND st.semester = s.semester
           AND st.deleted_at IS NULL
          JOIN school_calendar_days cd
            ON cd.school_term_id = st.id
           AND cd.day_type = 'SCHOOL_DAY'
           AND cd.deleted_at IS NULL
           AND cd.calendar_date <= CURRENT_DATE
          GROUP BY s.student_uuid
        ),
        case_summary AS (
          SELECT
            c.student_uuid,
            COUNT(*)::int AS open_case_count,
            (array_agg(c.id ORDER BY c.created_at DESC, c.id DESC))[1] AS latest_open_case_id,
            (array_agg(latest_task.task_id ORDER BY c.created_at DESC, c.id DESC))[1]
              AS latest_open_task_id,
            MAX(c.created_at) AS latest_case_at
          FROM cases c
          JOIN selected_students s ON s.student_uuid = c.student_uuid
          LEFT JOIN LATERAL (
            SELECT t.id AS task_id
            FROM tasks t
            WHERE t.case_id = c.id
              AND t.deleted_at IS NULL
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT 1
          ) latest_task ON true
          WHERE c.deleted_at IS NULL
            AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
          GROUP BY c.student_uuid
        ),
        metrics AS (
          SELECT
            s.student_uuid,
            s.school_id,
            s.grade_level_id,
            s.room_id,
            s.academic_year,
            s.semester,
            COALESCE(streak.consecutive_absent_days, 0)::int AS consecutive_absent_days,
            COALESCE(attendance.absent_days_since_case_reset, 0)::int AS absent_days_since_case_reset,
            COALESCE(term_attendance.term_absent_days, 0)::int AS term_absent_days,
            baseline.reset_after_date AS absence_reset_after_date,
            COALESCE(attendance.late_count, 0)::int AS late_count,
            COALESCE(subject_late.subject_late_count, 0)::int AS subject_late_count,
            COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0)::int
              AS school_day_count,
            COALESCE(teacher_signal.teacher_signal_count, 0)::int AS teacher_signal_count,
            -- Absence is counted in whole days now, so the weighted columns are
            -- the plain day count and the plain attendance rate they imply.
            COALESCE(attendance.absent_days_since_case_reset, 0)::numeric AS weighted_absence_days,
            CASE
              WHEN COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0) > 0
                THEN ROUND(
                  GREATEST(
                    0,
                    (
                      COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0)::numeric
                      - COALESCE(attendance.absent_days_since_case_reset, 0)::numeric
                    ) * 100
                    / COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0)::numeric
                  ),
                  1
                )
              ELSE NULL
            END AS weighted_attendance_percent,
            COALESCE(cases.open_case_count, 0)::int AS open_case_count,
            cases.latest_open_case_id,
            cases.latest_open_task_id,
            GREATEST(
              COALESCE(attendance.latest_attendance_at, '-infinity'::timestamptz),
              COALESCE(subject_late.latest_subject_late_at, '-infinity'::timestamptz),
              COALESCE(teacher_signal.latest_signal_at, '-infinity'::timestamptz),
              COALESCE(cases.latest_case_at, '-infinity'::timestamptz)
            ) AS source_updated_at
          FROM selected_students s
          LEFT JOIN absence_streak streak ON streak.student_uuid = s.student_uuid
          LEFT JOIN attendance_summary attendance ON attendance.student_uuid = s.student_uuid
          LEFT JOIN term_attendance_summary term_attendance
            ON term_attendance.student_uuid = s.student_uuid
          LEFT JOIN case_completion_baselines baseline ON baseline.student_uuid = s.student_uuid
          LEFT JOIN subject_late_summary subject_late ON subject_late.student_uuid = s.student_uuid
          LEFT JOIN teacher_signal_summary teacher_signal
            ON teacher_signal.student_uuid = s.student_uuid
          LEFT JOIN calendar_counts calendar ON calendar.student_uuid = s.student_uuid
          LEFT JOIN case_summary cases ON cases.student_uuid = s.student_uuid
        ),
        -- Three tiers only: ขาดสะสมถึงเกณฑ์ = เสี่ยง, มีความคิดเห็นจากครู =
        -- เฝ้าระวัง, นอกนั้นปกติ. Absent days are cumulative, not a streak.
        -- Which tiers exist and how they order is data in student_risk_tiers;
        -- only the rule that picks one stays here.
        tiered AS (
          SELECT
            metrics.*,
            CASE
              WHEN metrics.absent_days_since_case_reset >= $1::int THEN 'HIGH'
              WHEN metrics.teacher_signal_count > 0 THEN 'WATCH'
              ELSE 'NORMAL'
            END AS risk_tier,
            metrics.absent_days_since_case_reset::numeric / NULLIF($1::numeric, 0) AS risk_score
          FROM metrics
        ),
        -- risk_severity is the tier's own sort_order, read from the catalogue
        -- rather than restated here: the ladder is written once, and the
        -- composite FK on (risk_tier, risk_severity) makes any other pairing
        -- unstorable. The join is against three rows, once per run.
        scored AS (
          SELECT tiered.*, tier.sort_order AS risk_severity
          FROM tiered
          JOIN student_risk_tiers tier ON tier.code = tiered.risk_tier
        ),
        upserted AS (
          INSERT INTO student_risk_profiles (
            student_uuid,
            school_id,
            grade_level_id,
            room_id,
            academic_year,
            semester,
            consecutive_absent_days,
            absent_days_since_case_reset,
            term_absent_days,
            absence_reset_after_date,
            late_count,
            subject_late_count,
            school_day_count,
            weighted_absence_days,
            weighted_attendance_percent,
            risk_tier,
            risk_severity,
            risk_score,
            open_case_count,
            latest_open_case_id,
            latest_open_task_id,
            profile_calculated_at,
            source_updated_at,
            updated_at
          )
          SELECT
            student_uuid,
            school_id,
            grade_level_id,
            room_id,
            academic_year,
            semester,
            consecutive_absent_days,
            absent_days_since_case_reset,
            term_absent_days,
            absence_reset_after_date,
            late_count,
            subject_late_count,
            school_day_count,
            ROUND(weighted_absence_days, 2),
            weighted_attendance_percent,
            risk_tier,
            risk_severity,
            ROUND(risk_score, 4),
            open_case_count,
            latest_open_case_id,
            latest_open_task_id,
            now(),
            NULLIF(source_updated_at, '-infinity'::timestamptz),
            now()
          FROM scored
          ON CONFLICT (student_uuid) DO UPDATE SET
            school_id = EXCLUDED.school_id,
            grade_level_id = EXCLUDED.grade_level_id,
            room_id = EXCLUDED.room_id,
            academic_year = EXCLUDED.academic_year,
            semester = EXCLUDED.semester,
            consecutive_absent_days = EXCLUDED.consecutive_absent_days,
            absent_days_since_case_reset = EXCLUDED.absent_days_since_case_reset,
            term_absent_days = EXCLUDED.term_absent_days,
            absence_reset_after_date = EXCLUDED.absence_reset_after_date,
            late_count = EXCLUDED.late_count,
            subject_late_count = EXCLUDED.subject_late_count,
            school_day_count = EXCLUDED.school_day_count,
            weighted_absence_days = EXCLUDED.weighted_absence_days,
            weighted_attendance_percent = EXCLUDED.weighted_attendance_percent,
            risk_tier = EXCLUDED.risk_tier,
            risk_severity = EXCLUDED.risk_severity,
            risk_score = EXCLUDED.risk_score,
            open_case_count = EXCLUDED.open_case_count,
            latest_open_case_id = EXCLUDED.latest_open_case_id,
            latest_open_task_id = EXCLUDED.latest_open_task_id,
            profile_calculated_at = EXCLUDED.profile_calculated_at,
            source_updated_at = EXCLUDED.source_updated_at,
            updated_at = now()
          -- Only rewrite the row when a domain metric or the source watermark
          -- actually moved. Without this every recalculation rewrote all 5,980
          -- rows (profile_calculated_at/updated_at = now()), which is what drove
          -- the write amplification, table/index bloat and autovacuum churn.
          WHERE
            student_risk_profiles.school_id IS DISTINCT FROM EXCLUDED.school_id
            OR student_risk_profiles.grade_level_id IS DISTINCT FROM EXCLUDED.grade_level_id
            OR student_risk_profiles.room_id IS DISTINCT FROM EXCLUDED.room_id
            OR student_risk_profiles.academic_year IS DISTINCT FROM EXCLUDED.academic_year
            OR student_risk_profiles.semester IS DISTINCT FROM EXCLUDED.semester
            OR student_risk_profiles.consecutive_absent_days
                 IS DISTINCT FROM EXCLUDED.consecutive_absent_days
            OR student_risk_profiles.absent_days_since_case_reset IS DISTINCT FROM EXCLUDED.absent_days_since_case_reset
            OR student_risk_profiles.term_absent_days
                 IS DISTINCT FROM EXCLUDED.term_absent_days
            OR student_risk_profiles.absence_reset_after_date
                 IS DISTINCT FROM EXCLUDED.absence_reset_after_date
            OR student_risk_profiles.late_count IS DISTINCT FROM EXCLUDED.late_count
            OR student_risk_profiles.subject_late_count
                 IS DISTINCT FROM EXCLUDED.subject_late_count
            OR student_risk_profiles.school_day_count IS DISTINCT FROM EXCLUDED.school_day_count
            OR student_risk_profiles.weighted_absence_days
                 IS DISTINCT FROM EXCLUDED.weighted_absence_days
            OR student_risk_profiles.weighted_attendance_percent
                 IS DISTINCT FROM EXCLUDED.weighted_attendance_percent
            OR student_risk_profiles.risk_tier IS DISTINCT FROM EXCLUDED.risk_tier
            OR student_risk_profiles.risk_severity IS DISTINCT FROM EXCLUDED.risk_severity
            OR student_risk_profiles.risk_score IS DISTINCT FROM EXCLUDED.risk_score
            OR student_risk_profiles.open_case_count IS DISTINCT FROM EXCLUDED.open_case_count
            OR student_risk_profiles.latest_open_case_id
                 IS DISTINCT FROM EXCLUDED.latest_open_case_id
            OR student_risk_profiles.latest_open_task_id
                 IS DISTINCT FROM EXCLUDED.latest_open_task_id
            OR student_risk_profiles.source_updated_at IS DISTINCT FROM EXCLUDED.source_updated_at
          RETURNING student_uuid
        )
        SELECT
          (SELECT COUNT(*) FROM scored)::int AS evaluated,
          (SELECT COUNT(*) FROM upserted)::int AS changed
      `,
      params,
    );
    const evaluated = Number.parseInt(String(result.rows[0]?.evaluated ?? '0'), 10);
    const changed = Number.parseInt(String(result.rows[0]?.changed ?? '0'), 10);
    return { evaluated, changed, skipped: Math.max(0, evaluated - changed) };
  }
}
