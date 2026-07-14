import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type { CaseReportUpRow, SchoolOwnedCaseRow } from './case-report-ups.types';

interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

@Injectable()
export class CaseReportUpsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private executor(queryRunner?: QueryRunner): QueryExecutor {
    if (queryRunner) return createSqlQueryExecutor(queryRunner);
    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        await queryDataSource<T>(this.dataSource, sql, params),
    };
  }

  async lockSchoolOwnedCase(
    caseId: number,
    schoolIds: number[],
    queryRunner: QueryRunner,
  ): Promise<SchoolOwnedCaseRow | null> {
    const result = await this.executor(queryRunner).query<SchoolOwnedCaseRow>(
      `
        SELECT
          case_record.id,
          case_record.status,
          case_record.school_id,
          case_record.student_name,
          school.name AS school_name,
          school.province,
          school.district,
          school.sub_district
        FROM cases case_record
        JOIN schools school ON school.id = case_record.school_id
        WHERE case_record.id = $1
          AND case_record.school_id = ANY($2::int[])
          AND case_record.deleted_at IS NULL
        FOR UPDATE OF case_record
      `,
      [caseId, schoolIds],
    );
    return result.rows[0] ?? null;
  }

  async insertReportUp(
    input: {
      caseId: number;
      schoolId: number;
      reportedBy: number;
      reportedByLabel: string | null;
      reason: string;
      summary: string;
      schoolName: string | null;
      province: string | null;
      district: string | null;
      subDistrict: string | null;
    },
    queryRunner: QueryRunner,
  ): Promise<CaseReportUpRow> {
    const result = await this.executor(queryRunner).query<CaseReportUpRow>(
      `
        INSERT INTO case_report_ups (
          case_id,
          school_id,
          reported_by,
          reported_by_label,
          report_reason,
          report_summary,
          school_name_snapshot,
          province_snapshot,
          district_snapshot,
          sub_district_snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id,
          case_id,
          'REPORTED_UP'::text AS case_status,
          school_id,
          school_name_snapshot AS school_name,
          NULL::text AS student_name,
          reported_by,
          reported_by_label,
          report_reason,
          report_summary,
          province_snapshot,
          district_snapshot,
          sub_district_snapshot,
          reported_at
      `,
      [
        input.caseId,
        input.schoolId,
        input.reportedBy,
        input.reportedByLabel,
        input.reason,
        input.summary,
        input.schoolName,
        input.province,
        input.district,
        input.subDistrict,
      ],
    );
    return result.rows[0];
  }

  async transitionCaseToReportedUp(
    caseId: number,
    expectedStatus: string,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        UPDATE cases
        SET status = 'REPORTED_UP'
        WHERE id = $1
          AND status = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [caseId, expectedStatus],
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }

  async listReportUps(
    scope: DataScope,
    page: number,
    limit: number,
    caseId?: number,
  ): Promise<{ rows: CaseReportUpRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (typeof caseId === 'number') {
      params.push(caseId);
      conditions.push(`report_up.case_id = $${params.length}`);
    }

    if (scope.own_only === true || isUnconfiguredDataScope(scope)) {
      conditions.push('1=0');
    } else {
      const scopeQuery = buildDataScopeQuery(
        scope,
        {
          school_id: 'report_up.school_id',
          province: 'report_up.province_snapshot',
          district: 'report_up.district_snapshot',
          sub_district: 'report_up.sub_district_snapshot',
        },
        params.length + 1,
      );
      if (scopeQuery.sql) conditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, (page - 1) * limit);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const result = await queryDataSource<CaseReportUpRow>(
      this.dataSource,
      `
        SELECT
          report_up.id,
          report_up.case_id,
          case_record.status AS case_status,
          report_up.school_id,
          COALESCE(report_up.school_name_snapshot, school.name) AS school_name,
          case_record.student_name,
          report_up.reported_by,
          report_up.reported_by_label,
          report_up.report_reason,
          report_up.report_summary,
          report_up.province_snapshot,
          report_up.district_snapshot,
          report_up.sub_district_snapshot,
          report_up.reported_at,
          COUNT(*) OVER()::int AS total_count
        FROM case_report_ups report_up
        JOIN cases case_record
          ON case_record.id = report_up.case_id
         AND case_record.deleted_at IS NULL
        LEFT JOIN schools school ON school.id = report_up.school_id
        ${whereSql}
        ORDER BY report_up.reported_at DESC, report_up.id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    return {
      rows: result.rows,
      totalCount: Number(result.rows[0]?.total_count ?? 0),
    };
  }
}
