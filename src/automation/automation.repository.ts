import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  ConsecutiveAbsentStudentRow,
  CreateAutomatedCaseInput,
  CreatedCaseRow,
  OpenAbsenceCaseRow,
  QueryExecutor,
  QueryResultLike,
  SettingValueRow,
} from './automation.types';

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
    executor?: QueryExecutor,
  ): Promise<ConsecutiveAbsentStudentRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ConsecutiveAbsentStudentRow>(
      `
        WITH ranked_attendance AS (
          SELECT
            "PersonID_Onec",
            "AttendanceDate",
            "AttendanceStatus",
            ROW_NUMBER() OVER (
              PARTITION BY "PersonID_Onec"
              ORDER BY "AttendanceDate" DESC, "AttendanceID" DESC
            ) AS rn
          FROM attendance
        ),
        recent_consecutive_absences AS (
          SELECT "PersonID_Onec", COUNT(*) AS consecutive_days
          FROM ranked_attendance
          WHERE rn <= $1 AND "AttendanceStatus" = 2
          GROUP BY "PersonID_Onec"
          HAVING COUNT(*) >= $1
        )
        SELECT
          r."PersonID_Onec" AS person_id_onec,
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
        FROM recent_consecutive_absences r
        JOIN student_term s ON r."PersonID_Onec" = s."PersonID_Onec"
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
      `,
      [thresholdDays],
    );

    return result.rows;
  }

  async listOpenAbsenceCases(executor?: QueryExecutor): Promise<OpenAbsenceCaseRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<OpenAbsenceCaseRow>(
      `
        SELECT id, student_name, student_id
        FROM cases
        WHERE status = 'OPEN'
          AND deleted_at IS NULL
          AND reason_flagged LIKE 'ขาดเรียนติดต่อกัน%'
      `,
    );

    return result.rows;
  }

  async deleteOpenCaseById(id: number, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    // Soft-delete: a false-positive auto-case (attendance later corrected) is
    // tombstoned, not hard-deleted, so the create/cancel trail survives for
    // audit. deleted_by stays null — this is a system action, not a user.
    await queryExecutor.query(
      `UPDATE cases SET deleted_at = now() WHERE id = $1 AND status = $2 AND deleted_at IS NULL`,
      [id, 'OPEN'],
    );
  }

  async findOpenAbsenceCaseByStudent(
    studentId: string,
    studentName: string,
    schoolId: number | null,
    executor?: QueryExecutor,
  ): Promise<number | null> {
    const queryExecutor = this.getExecutor(executor);
    // Match by stable student_id; fall back to name only for legacy rows
    // created before student_id was populated (student_id IS NULL).
    const result = await queryExecutor.query<CreatedCaseRow>(
      `
        SELECT id FROM cases
        WHERE status = $1
          AND deleted_at IS NULL
          AND ($4::int IS NULL OR school_id = $4)
          AND (
            (student_id IS NOT NULL AND student_id = $2)
            OR (student_id IS NULL AND student_name = $3)
          )
      `,
      ['OPEN', studentId, studentName, schoolId],
    );

    return result.rows[0]?.id ?? null;
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
          student_id,
          school_id,
          student_school,
          student_address,
          reason_flagged,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN')
        RETURNING id
      `,
      [
        data.studentName,
        data.studentId,
        data.schoolId,
        data.schoolName,
        data.studentAddress,
        data.reason,
      ],
    );

    return result.rows[0].id;
  }
}
