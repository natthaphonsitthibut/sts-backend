import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { RiskDashboardThresholds } from '../task/task.types';

interface CountRow extends Record<string, unknown> {
  count: number | string;
}

const DEFAULT_RISK_PROFILE_THRESHOLDS: RiskDashboardThresholds = {
  lowConsecutiveAbsentDays: 3,
  mediumConsecutiveAbsentDays: 5,
  highConsecutiveAbsentDays: 7,
  watchProgressRatio: 0.7,
  lowAttendancePercent: 95,
  mediumAttendancePercent: 90,
  highAttendancePercent: 80,
  lateWeight: 0.25,
};

@Injectable()
export class RiskProfileRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getSystemSettingValue(settingKey: string): Promise<string | null> {
    const result = await queryDataSource<{ setting_value: string }>(
      this.dataSource,
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [settingKey],
    );
    return result.rows[0]?.setting_value ?? null;
  }

  async getRiskThresholds(): Promise<RiskDashboardThresholds> {
    const [low, medium, high] = await Promise.all([
      this.getSystemSettingValue('CASE_RISK_LOW_ABSENCE_DAYS'),
      this.getSystemSettingValue('CASE_RISK_MEDIUM_ABSENCE_DAYS'),
      this.getSystemSettingValue('CASE_RISK_HIGH_ABSENCE_DAYS'),
    ]);

    return {
      ...DEFAULT_RISK_PROFILE_THRESHOLDS,
      lowConsecutiveAbsentDays: this.parsePositiveInteger(
        low,
        DEFAULT_RISK_PROFILE_THRESHOLDS.lowConsecutiveAbsentDays,
      ),
      mediumConsecutiveAbsentDays: this.parsePositiveInteger(
        medium,
        DEFAULT_RISK_PROFILE_THRESHOLDS.mediumConsecutiveAbsentDays,
      ),
      highConsecutiveAbsentDays: this.parsePositiveInteger(
        high,
        DEFAULT_RISK_PROFILE_THRESHOLDS.highConsecutiveAbsentDays,
      ),
    };
  }

  async recalculateStudents(
    studentUuids: string[],
    thresholds: RiskDashboardThresholds,
  ): Promise<number> {
    const uniqueStudentUuids = [
      ...new Set(studentUuids.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueStudentUuids.length === 0) {
      return 0;
    }
    return await this.upsertProfiles(thresholds, 'WHERE s.student_uuid = ANY($9::uuid[])', [
      uniqueStudentUuids,
    ]);
  }

  async recalculateAll(thresholds: RiskDashboardThresholds): Promise<number> {
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

  private parsePositiveInteger(value: string | null, fallback: number): number {
    const parsed = value ? Number.parseInt(value, 10) : fallback;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async upsertProfiles(
    thresholds: RiskDashboardThresholds,
    selectedWhereSql: string,
    extraParams: unknown[],
  ): Promise<number> {
    const params: unknown[] = [
      thresholds.lowConsecutiveAbsentDays,
      thresholds.mediumConsecutiveAbsentDays,
      thresholds.highConsecutiveAbsentDays,
      thresholds.watchProgressRatio,
      thresholds.lowAttendancePercent,
      thresholds.mediumAttendancePercent,
      thresholds.highAttendancePercent,
      thresholds.lateWeight,
      ...extraParams,
    ];
    const result = await queryDataSource<CountRow>(
      this.dataSource,
      `
        WITH selected_students AS (
          SELECT
            s.student_uuid,
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
        ),
        attendance_daily AS (
          SELECT
            a.student_uuid,
            a."AttendanceDate"::date AS attendance_date,
            BOOL_AND(a."AttendanceStatus" = 2) AS is_absent_day,
            COUNT(*) FILTER (WHERE a."AttendanceStatus" = 2)::int AS absent_records,
            COUNT(*) FILTER (WHERE a."AttendanceStatus" = 3)::int AS late_records
          FROM attendance a
          JOIN selected_students s ON s.student_uuid = a.student_uuid
          WHERE a."AcademicYear_Onec" = s.academic_year
            AND a."Semester_Onec" = s.semester
            AND a.session_kind = 'DAILY'
          GROUP BY a.student_uuid, a."AttendanceDate"
        ),
        ranked_attendance_days AS (
          SELECT
            student_uuid,
            attendance_date,
            is_absent_day,
            ROW_NUMBER() OVER (PARTITION BY student_uuid ORDER BY attendance_date DESC) AS rn
          FROM attendance_daily
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
            COUNT(*) FILTER (WHERE is_absent_day)::int AS absent_days,
            COALESCE(SUM(late_records), 0)::int AS late_count,
            COUNT(*)::int AS recorded_day_count,
            MAX(attendance_date)::timestamptz AS latest_attendance_at
          FROM attendance_daily
          GROUP BY student_uuid
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
            AND c.status <> 'RESOLVED'
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
            COALESCE(attendance.absent_days, 0)::int AS absent_days,
            COALESCE(attendance.late_count, 0)::int AS late_count,
            COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0)::int
              AS school_day_count,
            (
              COALESCE(attendance.absent_days, 0)::numeric
              + (COALESCE(attendance.late_count, 0)::numeric * $8::numeric)
            ) AS weighted_absence_days,
            CASE
              WHEN COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0) > 0
                THEN ROUND(
                  GREATEST(
                    0,
                    (
                      COALESCE(NULLIF(calendar.school_day_count, 0), attendance.recorded_day_count, 0)::numeric
                      - (
                        COALESCE(attendance.absent_days, 0)::numeric
                        + (COALESCE(attendance.late_count, 0)::numeric * $8::numeric)
                      )
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
              COALESCE(cases.latest_case_at, '-infinity'::timestamptz)
            ) AS source_updated_at
          FROM selected_students s
          LEFT JOIN absence_streak streak ON streak.student_uuid = s.student_uuid
          LEFT JOIN attendance_summary attendance ON attendance.student_uuid = s.student_uuid
          LEFT JOIN calendar_counts calendar ON calendar.student_uuid = s.student_uuid
          LEFT JOIN case_summary cases ON cases.student_uuid = s.student_uuid
        ),
        scored AS (
          SELECT
            metrics.*,
            CASE
              WHEN metrics.consecutive_absent_days >= $3::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $7::numeric)
                THEN 'HIGH'
              WHEN metrics.consecutive_absent_days >= $2::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $6::numeric)
                THEN 'MEDIUM'
              WHEN metrics.consecutive_absent_days >= $1::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $5::numeric)
                THEN 'LOW'
              WHEN metrics.consecutive_absent_days >= CEIL($1::numeric * $4::numeric)
                OR metrics.absent_days >= CEIL($3::numeric * $4::numeric)
                OR (
                  metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent
                    <= (100::numeric - ((100::numeric - $5::numeric) * $4::numeric))
                )
                THEN 'WATCH'
              ELSE 'NORMAL'
            END AS risk_tier,
            CASE
              WHEN metrics.consecutive_absent_days >= $3::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $7::numeric)
                THEN 4
              WHEN metrics.consecutive_absent_days >= $2::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $6::numeric)
                THEN 3
              WHEN metrics.consecutive_absent_days >= $1::int
                OR (metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent < $5::numeric)
                THEN 2
              WHEN metrics.consecutive_absent_days >= CEIL($1::numeric * $4::numeric)
                OR metrics.absent_days >= CEIL($3::numeric * $4::numeric)
                OR (
                  metrics.weighted_attendance_percent IS NOT NULL
                  AND metrics.weighted_attendance_percent
                    <= (100::numeric - ((100::numeric - $5::numeric) * $4::numeric))
                )
                THEN 1
              ELSE 0
            END AS risk_severity,
            GREATEST(
              metrics.consecutive_absent_days::numeric / NULLIF($3::numeric, 0),
              metrics.absent_days::numeric / NULLIF($3::numeric, 0),
              CASE
                WHEN metrics.weighted_attendance_percent IS NULL THEN 0
                ELSE (100::numeric - metrics.weighted_attendance_percent)
                  / NULLIF(100::numeric - $7::numeric, 0)
              END
            ) AS risk_score
          FROM metrics
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
            absent_days,
            late_count,
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
            absent_days,
            late_count,
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
            absent_days = EXCLUDED.absent_days,
            late_count = EXCLUDED.late_count,
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
          RETURNING student_uuid
        )
        SELECT COUNT(*)::int AS count FROM upserted
      `,
      params,
    );
    return Number.parseInt(String(result.rows[0]?.count ?? '0'), 10);
  }
}
