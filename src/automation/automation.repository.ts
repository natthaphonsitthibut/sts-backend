import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  ActiveAbsenceCaseRow,
  ActiveAttendanceRiskCaseRow,
  ConsecutiveAbsentStudentRow,
  CreateAutomatedCaseInput,
  CreatedCaseRow,
  EscalateCaseRiskTierInput,
  OpenAbsenceCaseRow,
  QueryExecutor,
  QueryResultLike,
  SettingValueRow,
  SubjectLateWatchRow,
  SubjectRiskCandidateRow,
} from './automation.types';
import {
  ACTIVE_CASE_STATUSES,
  ATTENDANCE_RISK_CASE_REASON_PREFIXES,
  STUDENT_RISK_WATCH_NOTIFICATION_TYPE,
  STUDENT_RISK_WATCH_REF_ENTITY,
} from './subject-risk-monitor.constants';

@Injectable()
export class AutomationRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
    };
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => {
      return await callback(executor);
    });
  }

  async getSystemSettingValue(key: string, executor?: QueryExecutor): Promise<string | null> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<SettingValueRow>(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      [key],
    );

    return result.rows[0]?.setting_value ?? null;
  }

  async listConsecutiveAbsentStudents(
    thresholdDays: number,
    asOfDate: string,
    executor?: QueryExecutor,
  ): Promise<ConsecutiveAbsentStudentRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ConsecutiveAbsentStudentRow>(
      `
        WITH configured_enrollments AS (
          SELECT
            s.student_uuid,
            s."SchoolID_Onec" AS school_id,
            s."GradeLevelID_Onec" AS grade_level_id,
            s."RoomID_Onec" AS room_id,
            st.id AS school_term_id,
            st.starts_on,
            st.ends_on
          FROM student_term s
          JOIN school_terms st
            ON st.school_id = s."SchoolID_Onec"
           AND st.academic_year = s."AcademicYear_Onec"
           AND st.semester = s."Semester_Onec"
           AND st.status = 'ACTIVE'
           AND st.deleted_at IS NULL
           AND $2::date BETWEEN st.starts_on AND st.ends_on
          WHERE s.deleted_at IS NULL
        ),
        configured_days AS (
          SELECT
            enrollment.student_uuid,
            enrollment.school_term_id,
            enrollment.grade_level_id,
            enrollment.room_id,
            cd.calendar_date,
            ROW_NUMBER() OVER (
              PARTITION BY enrollment.student_uuid
              ORDER BY cd.calendar_date DESC
            ) AS rn
          FROM configured_enrollments enrollment
          JOIN school_calendar_days cd
            ON cd.school_term_id = enrollment.school_term_id
           AND cd.day_type = 'SCHOOL_DAY'
           AND cd.deleted_at IS NULL
           AND cd.calendar_date <= $2::date
           AND cd.calendar_date BETWEEN enrollment.starts_on AND enrollment.ends_on
        ),
        configured_day_flags AS (
          SELECT
            days.student_uuid,
            days.rn,
            (
              session.status = 'SUBMITTED'
              AND session.recorded_count = session.expected_roster_count
              AND attendance."AttendanceID" IS NOT NULL
              AND attendance."AttendanceStatus" = 2
            ) AS is_confirmed_absent_day
          FROM configured_days days
          LEFT JOIN attendance_sessions session
            ON session.school_term_id = days.school_term_id
           AND session.grade_level_id = days.grade_level_id
           AND session.room_id = days.room_id
           AND session.attendance_date = days.calendar_date
           AND session.period = 1
           AND session.session_kind = 'DAILY'
           AND session.deleted_at IS NULL
          LEFT JOIN attendance
            ON attendance.session_id = session.id
           AND attendance.student_uuid = days.student_uuid
        ),
        configured_streak_boundaries AS (
          SELECT
            student_uuid,
            rn,
            is_confirmed_absent_day,
            MIN(CASE WHEN NOT COALESCE(is_confirmed_absent_day, FALSE) THEN rn END) OVER (
              PARTITION BY student_uuid
            ) AS first_break_rn
          FROM configured_day_flags
        ),
        configured_candidates AS (
          SELECT student_uuid, COUNT(*)::int AS consecutive_days
          FROM configured_streak_boundaries
          WHERE COALESCE(is_confirmed_absent_day, FALSE)
            AND (first_break_rn IS NULL OR rn < first_break_rn)
          GROUP BY student_uuid
          HAVING COUNT(*) >= $1
        ),
        fallback_daily_attendance AS (
          SELECT
            a.student_uuid,
            a."AttendanceDate",
            BOOL_AND(a."AttendanceStatus" = 2) AS is_absent_day
          FROM attendance a
          JOIN student_term current_enrollment ON current_enrollment.student_uuid = a.student_uuid
          WHERE a.student_uuid IS NOT NULL
            AND a.session_kind = 'DAILY'
            AND a."AcademicYear_Onec" = current_enrollment."AcademicYear_Onec"
            AND a."Semester_Onec" = current_enrollment."Semester_Onec"
            AND current_enrollment.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM school_terms managed_term
              WHERE managed_term.school_id = current_enrollment."SchoolID_Onec"
                AND managed_term.academic_year = current_enrollment."AcademicYear_Onec"
                AND managed_term.semester = current_enrollment."Semester_Onec"
                AND managed_term.deleted_at IS NULL
            )
          GROUP BY a.student_uuid, a."AttendanceDate"
        ),
        ranked_attendance_days AS (
          SELECT
            student_uuid,
            "AttendanceDate",
            is_absent_day,
            ROW_NUMBER() OVER (
              PARTITION BY student_uuid
              ORDER BY "AttendanceDate" DESC
            ) AS rn
          FROM fallback_daily_attendance
        ),
        streak_boundaries AS (
          SELECT
            student_uuid,
            rn,
            is_absent_day,
            MIN(CASE WHEN NOT is_absent_day THEN rn END) OVER (
              PARTITION BY student_uuid
            ) AS first_non_absent_rn
          FROM ranked_attendance_days
        ),
        fallback_absence_streak AS (
          SELECT student_uuid, COUNT(*) AS consecutive_days
          FROM streak_boundaries
          WHERE is_absent_day
            AND (first_non_absent_rn IS NULL OR rn < first_non_absent_rn)
          GROUP BY student_uuid
          HAVING COUNT(*) >= $1
        ),
        candidates AS (
          SELECT student_uuid, consecutive_days FROM configured_candidates
          UNION ALL
          SELECT student_uuid, consecutive_days::int FROM fallback_absence_streak
        )
        SELECT
          r.student_uuid,
          r.consecutive_days::int AS consecutive_days,
          s."FirstName_Onec" AS first_name_onec,
          s."LastName_Onec" AS last_name_onec,
          s."SchoolID_Onec" AS school_id_onec,
          s."VillageNumber_Onec" AS village_number_onec,
          s."Street_Onec" AS street_onec,
          s."Soi_Onec" AS soi_onec,
          s."SubDistrictNameThai_Onec" AS sub_district_name_thai_onec,
          s."DistrictNameThai_Onec" AS district_name_thai_onec,
          s."ProvinceNameThai_Onec" AS province_name_thai_onec,
          sc.name AS school_name
        FROM candidates r
        JOIN student_term s ON r.student_uuid = s.student_uuid
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      `,
      [thresholdDays, asOfDate],
    );

    return result.rows;
  }

  async listEvaluableStudentUuids(
    studentUuids: string[],
    thresholdDays: number,
    asOfDate: string,
    executor?: QueryExecutor,
  ): Promise<string[]> {
    if (studentUuids.length === 0) return [];
    const result = await this.getExecutor(executor).query<{ student_uuid: string }>(
      `
        WITH requested AS (
          SELECT UNNEST($1::uuid[]) AS student_uuid
        ), configured_enrollments AS (
          SELECT
            s.student_uuid,
            s."GradeLevelID_Onec" AS grade_level_id,
            s."RoomID_Onec" AS room_id,
            st.id AS school_term_id,
            st.starts_on,
            st.ends_on
          FROM student_term s
          JOIN requested requested_student ON requested_student.student_uuid = s.student_uuid
          JOIN school_terms st
            ON st.school_id = s."SchoolID_Onec"
           AND st.academic_year = s."AcademicYear_Onec"
           AND st.semester = s."Semester_Onec"
           AND st.status = 'ACTIVE'
           AND st.deleted_at IS NULL
           AND $3::date BETWEEN st.starts_on AND st.ends_on
          WHERE s.deleted_at IS NULL
        ), latest_days AS (
          SELECT
            enrollment.student_uuid,
            enrollment.school_term_id,
            enrollment.grade_level_id,
            enrollment.room_id,
            cd.calendar_date,
            ROW_NUMBER() OVER (
              PARTITION BY enrollment.student_uuid ORDER BY cd.calendar_date DESC
            ) AS rn
          FROM configured_enrollments enrollment
          JOIN school_calendar_days cd
            ON cd.school_term_id = enrollment.school_term_id
           AND cd.day_type = 'SCHOOL_DAY'
           AND cd.deleted_at IS NULL
           AND cd.calendar_date <= $3::date
           AND cd.calendar_date BETWEEN enrollment.starts_on AND enrollment.ends_on
        ), configured_evaluable AS (
          SELECT days.student_uuid
          FROM latest_days days
          JOIN attendance_sessions session
            ON session.school_term_id = days.school_term_id
           AND session.grade_level_id = days.grade_level_id
           AND session.room_id = days.room_id
           AND session.attendance_date = days.calendar_date
           AND session.period = 1
           AND session.session_kind = 'DAILY'
           AND session.status = 'SUBMITTED'
           AND session.recorded_count = session.expected_roster_count
           AND session.deleted_at IS NULL
          JOIN attendance attendance_record
            ON attendance_record.session_id = session.id
           AND attendance_record.student_uuid = days.student_uuid
          WHERE days.rn <= $2
          GROUP BY days.student_uuid
          HAVING COUNT(*) = $2
        ), fallback_evaluable AS (
          SELECT DISTINCT a.student_uuid
          FROM attendance a
          JOIN requested requested_student ON requested_student.student_uuid = a.student_uuid
          JOIN student_term current_enrollment ON current_enrollment.student_uuid = a.student_uuid
          WHERE a."AcademicYear_Onec" = current_enrollment."AcademicYear_Onec"
            AND a."Semester_Onec" = current_enrollment."Semester_Onec"
            AND current_enrollment.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM school_terms managed_term
              WHERE managed_term.school_id = current_enrollment."SchoolID_Onec"
                AND managed_term.academic_year = current_enrollment."AcademicYear_Onec"
                AND managed_term.semester = current_enrollment."Semester_Onec"
                AND managed_term.deleted_at IS NULL
            )
        )
        SELECT student_uuid FROM configured_evaluable
        UNION
        SELECT student_uuid FROM fallback_evaluable
      `,
      [studentUuids, thresholdDays, asOfDate],
    );
    return result.rows.map((row) => row.student_uuid);
  }

  async listOpenAbsenceCases(executor?: QueryExecutor): Promise<OpenAbsenceCaseRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<OpenAbsenceCaseRow>(
      `
        SELECT id, student_name, student_uuid, school_id
        FROM cases
        WHERE status = 'OPEN'
          AND deleted_at IS NULL
          AND reason_flagged LIKE 'ขาดเรียนติดต่อกัน%'
      `,
    );

    return result.rows;
  }

  async deleteOpenCaseById(id: number, executor?: QueryExecutor): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    // Soft-delete: a false-positive auto-case (attendance later corrected) is
    // tombstoned, not hard-deleted, so the create/cancel trail survives for
    // audit. deleted_by stays null — this is a system action, not a user.
    const result = await queryExecutor.query(
      `UPDATE cases SET deleted_at = now() WHERE id = $1 AND status = $2 AND deleted_at IS NULL`,
      [id, 'OPEN'],
    );
    return result.rowCount > 0;
  }

  async findActiveAbsenceCaseByStudent(
    studentUuid: string,
    studentName: string,
    schoolId: number | null,
    executor?: QueryExecutor,
  ): Promise<ActiveAbsenceCaseRow | null> {
    const queryExecutor = this.getExecutor(executor);
    // Match by stable student_uuid; fall back to name only for legacy rows
    // created before student_uuid was populated (student_uuid IS NULL).
    const result = await queryExecutor.query<ActiveAbsenceCaseRow>(
      `
        SELECT id, risk_tier FROM cases
        WHERE status = ANY($1::text[])
          AND deleted_at IS NULL
          AND reason_flagged LIKE 'ขาดเรียนติดต่อกัน%'
          AND ($4::int IS NULL OR school_id = $4)
          AND (
            (student_uuid IS NOT NULL AND student_uuid = $2)
            OR (student_uuid IS NULL AND student_name = $3)
          )
      `,
      [[...ACTIVE_CASE_STATUSES], studentUuid, studentName, schoolId],
    );

    return result.rows[0] ?? null;
  }

  async findActiveAttendanceRiskCaseByStudent(
    studentUuid: string,
    studentName: string,
    schoolId: number | null,
    executor?: QueryExecutor,
  ): Promise<ActiveAttendanceRiskCaseRow | null> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ActiveAttendanceRiskCaseRow>(
      `
        SELECT id, risk_tier, reason_flagged
        FROM cases
        WHERE status = ANY($1::text[])
          AND deleted_at IS NULL
          AND ($4::int IS NULL OR school_id = $4)
          AND reason_flagged LIKE ANY($5::text[])
          AND (
            (student_uuid IS NOT NULL AND student_uuid = $2)
            OR (student_uuid IS NULL AND student_name = $3)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [
        [...ACTIVE_CASE_STATUSES],
        studentUuid,
        studentName,
        schoolId,
        [...ATTENDANCE_RISK_CASE_REASON_PREFIXES],
      ],
    );

    return result.rows[0] ?? null;
  }

  async escalateCaseRiskTier(
    input: EscalateCaseRiskTierInput,
    executor?: QueryExecutor,
  ): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    // Tighten, never loosen: keep the earlier of the existing due date and the
    // new tier's due date. Reset SLA markers so the reminder cron re-evaluates
    // warning/breach against the tightened deadline.
    const result = await queryExecutor.query(
      `
        UPDATE cases
        SET risk_tier = $2,
            sla_due_at = LEAST(COALESCE(sla_due_at, $3::timestamptz), $3::timestamptz),
            sla_warning_notified_at = NULL,
            sla_breached_notified_at = NULL,
            reason_flagged = $4
        WHERE id = $1
          AND deleted_at IS NULL
          AND status = ANY($5::text[])
      `,
      [
        input.caseId,
        input.riskTier,
        input.slaDueAt.toISOString(),
        input.reason,
        [...ACTIVE_CASE_STATUSES],
      ],
    );
    return result.rowCount > 0;
  }

  async createAutomatedCase(
    data: CreateAutomatedCaseInput,
    executor?: QueryExecutor,
  ): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<CreatedCaseRow>(
      `
        INSERT INTO cases (
          student_name,
          student_uuid,
          school_id,
          student_school,
          student_address,
          reason_flagged,
          risk_tier,
          sla_due_at,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN')
        RETURNING id
      `,
      [
        data.studentName,
        data.studentUuid,
        data.schoolId,
        data.schoolName,
        data.studentAddress,
        data.reason,
        data.riskTier,
        data.slaDueAt.toISOString(),
      ],
    );

    return result.rows[0].id;
  }

  async insertSystemCaseReviewNote(
    caseId: number,
    reviewNote: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(
      `
        INSERT INTO case_reviews (
          id,
          case_id,
          review_action,
          review_note,
          reviewed_by
        )
        VALUES (gen_random_uuid()::text, $1, 'CONTINUE', $2, $3)
      `,
      [caseId, reviewNote, 'system:subject-risk-monitor'],
    );
  }

  async hasSystemCaseReviewNote(
    caseId: number,
    reviewNote: string,
    executor?: QueryExecutor,
  ): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<{ id: string }>(
      `
        SELECT id
        FROM case_reviews
        WHERE case_id = $1
          AND reviewed_by = $2
          AND review_note = $3
        LIMIT 1
      `,
      [caseId, 'system:subject-risk-monitor', reviewNote],
    );
    return result.rows.length > 0;
  }

  async listSubjectRiskCandidates(
    input: {
      asOfDate: string;
      mixedWindowDays: number;
      mixedAbsenceDays: number;
      avoidanceWindowDays: number;
      avoidanceConsecutivePeriods: number;
      avoidanceAbsentPercent: number;
      termAbsenceDays: number;
      highAttendancePercent: number;
    },
    executor?: QueryExecutor,
  ): Promise<SubjectRiskCandidateRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<SubjectRiskCandidateRow>(
      `
        WITH subject_attendance AS (
          SELECT
            a.student_uuid,
            a."AttendanceDate"::date AS attendance_date,
            a."AttendanceStatus" AS attendance_status,
            sess.subject_id,
            sess.period,
            sub.name_th AS subject_name_th,
            sub.code AS subject_code
          FROM attendance a
          JOIN attendance_sessions sess ON sess.id = a.session_id
          JOIN subjects sub ON sub.id = sess.subject_id
          WHERE a.student_uuid IS NOT NULL
            AND a.session_kind = 'SUBJECT'
            AND sess.session_kind = 'SUBJECT'
            AND sess.status = 'SUBMITTED'
            AND sess.deleted_at IS NULL
            AND a."AttendanceDate"::date <= $1::date
            AND a."AttendanceDate"::date >= $1::date - ((GREATEST($2::int, $4::int) - 1) * INTERVAL '1 day')
        ),
        mixed_days AS (
          SELECT student_uuid, attendance_date
          FROM subject_attendance
          WHERE attendance_date >= $1::date - (($2::int - 1) * INTERVAL '1 day')
          GROUP BY student_uuid, attendance_date
          HAVING COUNT(*) FILTER (WHERE attendance_status = 2) > 0
             AND COUNT(*) FILTER (WHERE attendance_status <> 2) > 0
        ),
        mixed_candidates AS (
          SELECT
            'MIXED_SUBJECT_ABSENCE'::text AS signal_code,
            student_uuid,
            COUNT(*)::int AS metric_value,
            $3::int AS threshold_value,
            NULL::int AS subject_id,
            NULL::text AS subject_name_th,
            NULL::text AS subject_code
          FROM mixed_days
          GROUP BY student_uuid
          HAVING COUNT(*) >= $3
        ),
        subject_ranked AS (
          SELECT
            student_uuid,
            subject_id,
            subject_name_th,
            subject_code,
            attendance_status,
            ROW_NUMBER() OVER (
              PARTITION BY student_uuid, subject_id
              ORDER BY attendance_date DESC, period DESC
            ) AS rn
          FROM subject_attendance
          WHERE attendance_date >= $1::date - (($4::int - 1) * INTERVAL '1 day')
        ),
        subject_streak_boundaries AS (
          SELECT
            *,
            MIN(CASE WHEN attendance_status <> 2 THEN rn END) OVER (
              PARTITION BY student_uuid, subject_id
            ) AS first_non_absent_rn
          FROM subject_ranked
        ),
        subject_streak_candidates AS (
          SELECT
            'SUBJECT_AVOIDANCE_STREAK'::text AS signal_code,
            student_uuid,
            COUNT(*)::int AS metric_value,
            $5::int AS threshold_value,
            subject_id,
            subject_name_th,
            subject_code
          FROM subject_streak_boundaries
          WHERE attendance_status = 2
            AND (first_non_absent_rn IS NULL OR rn < first_non_absent_rn)
          GROUP BY student_uuid, subject_id, subject_name_th, subject_code
          HAVING COUNT(*) >= $5
        ),
        subject_percent_candidates AS (
          SELECT
            'SUBJECT_AVOIDANCE_PERCENT'::text AS signal_code,
            student_uuid,
            ROUND(
              (COUNT(*) FILTER (WHERE attendance_status = 2)::numeric / NULLIF(COUNT(*), 0)) * 100
            )::int AS metric_value,
            $6::int AS threshold_value,
            subject_id,
            subject_name_th,
            subject_code
          FROM subject_attendance
          WHERE attendance_date >= $1::date - (($4::int - 1) * INTERVAL '1 day')
          GROUP BY student_uuid, subject_id, subject_name_th, subject_code
          HAVING (COUNT(*) FILTER (WHERE attendance_status = 2)::numeric / NULLIF(COUNT(*), 0)) * 100 >= $6
        ),
        daily_term_attendance AS (
          SELECT
            a.student_uuid,
            a."AttendanceStatus" AS attendance_status
          FROM attendance a
          JOIN student_term current_enrollment
            ON current_enrollment.student_uuid = a.student_uuid
           AND current_enrollment."AcademicYear_Onec" = a."AcademicYear_Onec"
           AND current_enrollment."Semester_Onec" = a."Semester_Onec"
           AND current_enrollment.deleted_at IS NULL
          WHERE a.student_uuid IS NOT NULL
            AND a.session_kind = 'DAILY'
            AND a."AttendanceDate"::date <= $1::date
        ),
        term_summary AS (
          SELECT
            student_uuid,
            COUNT(*) FILTER (WHERE attendance_status = 2)::int AS absent_days,
            ROUND(
              (COUNT(*) FILTER (WHERE attendance_status <> 2)::numeric / NULLIF(COUNT(*), 0)) * 100
            )::int AS attendance_percent
          FROM daily_term_attendance
          GROUP BY student_uuid
        ),
        term_absence_candidates AS (
          SELECT
            'TERM_ABSENCE_ACCUMULATION'::text AS signal_code,
            student_uuid,
            absent_days AS metric_value,
            $7::int AS threshold_value,
            NULL::int AS subject_id,
            NULL::text AS subject_name_th,
            NULL::text AS subject_code
          FROM term_summary
          WHERE absent_days >= $7
        ),
        low_attendance_candidates AS (
          SELECT
            'LOW_ATTENDANCE_PERCENT'::text AS signal_code,
            student_uuid,
            attendance_percent AS metric_value,
            $8::int AS threshold_value,
            NULL::int AS subject_id,
            NULL::text AS subject_name_th,
            NULL::text AS subject_code
          FROM term_summary
          WHERE attendance_percent < $8
        ),
        candidates AS (
          SELECT * FROM mixed_candidates
          UNION ALL
          SELECT * FROM subject_streak_candidates
          UNION ALL
          SELECT * FROM subject_percent_candidates
          UNION ALL
          SELECT * FROM term_absence_candidates
          UNION ALL
          SELECT * FROM low_attendance_candidates
        )
        SELECT
          candidates.signal_code,
          candidates.student_uuid,
          candidates.metric_value,
          candidates.threshold_value,
          candidates.subject_id,
          candidates.subject_name_th,
          candidates.subject_code,
          s."FirstName_Onec" AS first_name_onec,
          s."LastName_Onec" AS last_name_onec,
          s."SchoolID_Onec" AS school_id_onec,
          s."VillageNumber_Onec" AS village_number_onec,
          s."Street_Onec" AS street_onec,
          s."Soi_Onec" AS soi_onec,
          s."SubDistrictNameThai_Onec" AS sub_district_name_thai_onec,
          s."DistrictNameThai_Onec" AS district_name_thai_onec,
          s."ProvinceNameThai_Onec" AS province_name_thai_onec,
          s."GradeLevelID_Onec" AS grade_level_id_onec,
          s."RoomID_Onec" AS room_id_onec,
          sc.name AS school_name
        FROM candidates
        JOIN student_term s ON s.student_uuid = candidates.student_uuid
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        WHERE s.deleted_at IS NULL
        ORDER BY candidates.student_uuid, candidates.signal_code, candidates.metric_value DESC
      `,
      [
        input.asOfDate,
        input.mixedWindowDays,
        input.mixedAbsenceDays,
        input.avoidanceWindowDays,
        input.avoidanceConsecutivePeriods,
        input.avoidanceAbsentPercent,
        input.termAbsenceDays,
        input.highAttendancePercent,
      ],
    );

    return result.rows;
  }

  async listSubjectLateWatchCandidates(
    input: { asOfDate: string; lateWindowDays: number; lateWatchCount: number },
    executor?: QueryExecutor,
  ): Promise<SubjectLateWatchRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<SubjectLateWatchRow>(
      `
        WITH late_counts AS (
          SELECT
            a.student_uuid,
            COUNT(*)::int AS late_count
          FROM attendance a
          JOIN attendance_sessions sess ON sess.id = a.session_id
          WHERE a.student_uuid IS NOT NULL
            AND a.session_kind = 'SUBJECT'
            AND a."AttendanceStatus" = 3
            AND sess.session_kind = 'SUBJECT'
            AND sess.status = 'SUBMITTED'
            AND sess.deleted_at IS NULL
            AND a."AttendanceDate"::date <= $1::date
            AND a."AttendanceDate"::date >= $1::date - (($2::int - 1) * INTERVAL '1 day')
          GROUP BY a.student_uuid
          HAVING COUNT(*) >= $3
        )
        SELECT
          late_counts.student_uuid,
          late_counts.late_count,
          $3::int AS threshold_value,
          s."FirstName_Onec" AS first_name_onec,
          s."LastName_Onec" AS last_name_onec,
          s."SchoolID_Onec" AS school_id_onec,
          s."GradeLevelID_Onec" AS grade_level_id_onec,
          s."RoomID_Onec" AS room_id_onec,
          sc.name AS school_name
        FROM late_counts
        JOIN student_term s ON s.student_uuid = late_counts.student_uuid
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        WHERE s.deleted_at IS NULL
        ORDER BY late_counts.late_count DESC, late_counts.student_uuid
      `,
      [input.asOfDate, input.lateWindowDays, input.lateWatchCount],
    );
    return result.rows;
  }

  async hasRiskWatchNotification(refId: string, executor?: QueryExecutor): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<{ id: string }>(
      `
        SELECT id
        FROM notifications
        WHERE type_code = $2
          AND ref_entity = $3
          AND ref_id = $1
        LIMIT 1
      `,
      [refId, STUDENT_RISK_WATCH_NOTIFICATION_TYPE, STUDENT_RISK_WATCH_REF_ENTITY],
    );
    return result.rows.length > 0;
  }
}
