import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  ActiveAbsenceCaseRow,
  CumulativeAbsentStudentRow,
  CreateAutomatedCaseInput,
  CreatedCaseRow,
  OpenAbsenceCaseRow,
  QueryExecutor,
  QueryResultLike,
  SettingValueRow,
} from './automation.types';
import { ACTIVE_CASE_STATUSES, ABSENCE_CASE_REASON_PREFIXES } from './automation.constants';

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

  /**
   * Students whose cumulative absent days reached the threshold, using the same
   * day verdict as ประวัติการเข้าเรียน: ลา (status 4) is not measured, มา/สาย
   * count as attended, and a day is ขาด only when every measured record that day
   * is unattended. Days need not be consecutive.
   */
  /**
   * `studentUuids` narrows the sweep to the students a caller just touched. A
   * check-in can only move its own class's counts, so the save path passes them
   * and skips scanning every enrolment in the country; the nightly job passes
   * nothing and still sweeps everyone.
   */
  async listCumulativeAbsentStudents(
    thresholdDays: number,
    asOfDate: string,
    executor?: QueryExecutor,
    studentUuids?: readonly string[],
  ): Promise<CumulativeAbsentStudentRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const scopedUuids = studentUuids && studentUuids.length > 0 ? [...studentUuids] : null;
    const result = await queryExecutor.query<CumulativeAbsentStudentRow>(
      `
        WITH current_enrollments AS (
          SELECT enrollment.student_uuid
          FROM student_term enrollment
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = enrollment.person_uuid
           AND current_enrollment.selected_student_uuid = enrollment.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          WHERE enrollment.deleted_at IS NULL
        ), resolved_case_baselines AS (
          SELECT
            tracked_case.student_uuid,
            MAX(COALESCE(latest_review.reviewed_at, tracked_case.updated_at))::date
              AS reset_after_date
          FROM cases tracked_case
          JOIN current_enrollments enrollment
            ON enrollment.student_uuid = tracked_case.student_uuid
          LEFT JOIN LATERAL (
            SELECT review.reviewed_at
            FROM case_reviews review
            WHERE review.case_id = tracked_case.id
            ORDER BY review.reviewed_at DESC, review.id DESC
            LIMIT 1
          ) latest_review ON TRUE
          WHERE tracked_case.status = 'RESOLVED'
            AND tracked_case.deleted_at IS NULL
          GROUP BY tracked_case.student_uuid
        ), classified_days AS (
          SELECT
            a.student_uuid,
            a."AttendanceDate"::date AS attendance_date,
            (
              COUNT(*) FILTER (WHERE a."AttendanceStatus" <> 4) > 0
              AND COUNT(*) FILTER (WHERE a."AttendanceStatus" IN (1, 3)) = 0
            ) AS is_absent_day
          FROM attendance a
          JOIN student_term enrollment
            ON enrollment.student_uuid = a.student_uuid
           AND enrollment."AcademicYear_Onec" = a."AcademicYear_Onec"
           AND enrollment."Semester_Onec" = a."Semester_Onec"
           AND enrollment.deleted_at IS NULL
          JOIN current_enrollments current_enrollment
            ON current_enrollment.student_uuid = enrollment.student_uuid
          LEFT JOIN resolved_case_baselines baseline
            ON baseline.student_uuid = a.student_uuid
          WHERE a.student_uuid IS NOT NULL
            AND ($3::uuid[] IS NULL OR a.student_uuid = ANY($3::uuid[]))
            AND a.session_kind = 'SUBJECT'
            AND a."AttendanceDate"::date <= $2::date
            AND a."AttendanceDate"::date > COALESCE(baseline.reset_after_date, '-infinity'::date)
          GROUP BY a.student_uuid, a."AttendanceDate"
        ),
        candidates AS (
          SELECT student_uuid, COUNT(*)::int AS absent_days
          FROM classified_days
          WHERE is_absent_day
            AND NOT EXISTS (
              SELECT 1
              FROM attendance demo_distribution
              WHERE demo_distribution.student_uuid = classified_days.student_uuid
                AND demo_distribution."RecordedBy" = 'SYSTEM:DEMO_RISK_DISTRIBUTION'
            )
          GROUP BY student_uuid
          HAVING COUNT(*) >= $1
        )
        SELECT
          r.student_uuid,
          r.absent_days,
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
      [thresholdDays, asOfDate, scopedUuids],
    );

    return result.rows;
  }

  async listEvaluableStudentUuids(
    studentUuids: string[],
    asOfDate: string,
    executor?: QueryExecutor,
  ): Promise<string[]> {
    if (studentUuids.length === 0) return [];
    const result = await this.getExecutor(executor).query<{ student_uuid: string }>(
      `
        WITH requested AS (
          SELECT UNNEST($1::uuid[]) AS student_uuid
        ), current_enrollments AS (
          SELECT s.student_uuid, s."AcademicYear_Onec" AS academic_year,
                 s."Semester_Onec" AS semester
          FROM student_term s
          JOIN requested requested_student ON requested_student.student_uuid = s.student_uuid
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = s.person_uuid
           AND current_enrollment.selected_student_uuid = s.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          WHERE s.deleted_at IS NULL
        )
        SELECT DISTINCT attendance.student_uuid
        FROM attendance
        JOIN current_enrollments enrollment
          ON enrollment.student_uuid = attendance.student_uuid
         AND enrollment.academic_year = attendance."AcademicYear_Onec"
         AND enrollment.semester = attendance."Semester_Onec"
        WHERE attendance.session_kind = 'SUBJECT'
          AND attendance."AttendanceDate"::date <= $2::date
      `,
      [studentUuids, asOfDate],
    );
    return result.rows.map((row) => row.student_uuid);
  }

  async listOpenAbsenceCases(
    executor?: QueryExecutor,
    studentUuids?: readonly string[],
  ): Promise<OpenAbsenceCaseRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const scopedUuids = studentUuids && studentUuids.length > 0 ? [...studentUuids] : null;
    const result = await queryExecutor.query<OpenAbsenceCaseRow>(
      `
        SELECT id, student_name, student_uuid, school_id
        FROM cases
        WHERE status = 'OPEN'
          AND deleted_at IS NULL
          AND reason_flagged LIKE ANY($1::text[])
          AND ($2::uuid[] IS NULL OR student_uuid = ANY($2::uuid[]))
      `,
      [[...ABSENCE_CASE_REASON_PREFIXES], scopedUuids],
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
          AND reason_flagged LIKE ANY($5::text[])
          AND ($4::int IS NULL OR school_id = $4)
          AND (
            (student_uuid IS NOT NULL AND student_uuid = $2)
            OR (student_uuid IS NULL AND student_name = $3)
          )
      `,
      [
        [...ACTIVE_CASE_STATUSES],
        studentUuid,
        studentName,
        schoolId,
        [...ABSENCE_CASE_REASON_PREFIXES],
      ],
    );

    return result.rows[0] ?? null;
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
}
