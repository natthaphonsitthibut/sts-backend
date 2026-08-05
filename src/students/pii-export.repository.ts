import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
import {
  queryDataSource,
  withDataSourceTransaction,
  type SqlQueryExecutor,
} from '../database/sql-query';
import type { PiiExportRequestRow, PiiExportStudentRow } from './pii-export.types';

const STUDENT_SCOPE_ALIASES = {
  school_id: `s."SchoolID_Onec"`,
  grade: `s."GradeLevelID_Onec"`,
  room: `s."RoomID_Onec"::text`,
  province: 'sc.province',
  district: 'sc.district',
  sub_district: 'sc.sub_district',
} as const;

interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

function normalizeScopeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
  );
}

@Injectable()
export class PiiExportRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  async withTransaction<T>(callback: (executor: SqlQueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, callback);
  }

  private studentScopeWhere(scope: DataScope, startIndex = 1): { sql: string; params: unknown[] } {
    const scopeResult = buildDataScopeQuery(scope, STUDENT_SCOPE_ALIASES, startIndex);
    return {
      sql: scopeResult.sql ? `WHERE ${scopeResult.sql}` : '',
      params: scopeResult.params,
    };
  }

  private studentScopeSelectionWhere(
    scope: DataScope,
    selectedStudentUuids?: string[],
  ): { sql: string; params: unknown[] } {
    const where = this.studentScopeWhere(scope);
    const conditions = where.sql ? [where.sql.replace(/^WHERE\s+/u, '')] : [];
    const params = [...where.params];
    if (selectedStudentUuids?.length) {
      params.push(selectedStudentUuids);
      conditions.push(`s.student_uuid = ANY($${params.length}::uuid[])`);
    }
    return {
      sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  async countStudentsForScope(scope: DataScope, selectedStudentUuids?: string[]): Promise<number> {
    const where = this.studentScopeSelectionWhere(scope, selectedStudentUuids);
    const result = await this.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        ${where.sql}
      `,
      where.params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async createRequest(
    input: {
      requesterUserId: number;
      scopeSnapshot: DataScope;
      includeFullNationalId: boolean;
      reasonCode: string;
      reasonNote: string;
      rowEstimate: number;
    },
    executor: SqlQueryExecutor,
  ): Promise<PiiExportRequestRow> {
    const result = await executor.query<PiiExportRequestRow>(
      `
        INSERT INTO pii_export_requests (
          requester_user_id,
          scope_snapshot,
          include_full_national_id,
          reason_code,
          reason_note,
          row_estimate
        )
        VALUES ($1, $2::jsonb, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        input.requesterUserId,
        JSON.stringify(input.scopeSnapshot),
        input.includeFullNationalId,
        input.reasonCode,
        input.reasonNote,
        input.rowEstimate,
      ],
    );
    return result.rows[0];
  }

  async insertRequestStudents(
    requestId: string,
    studentUuids: string[],
    executor: SqlQueryExecutor,
  ): Promise<void> {
    if (studentUuids.length === 0) {
      return;
    }
    await executor.query(
      `
        INSERT INTO pii_export_request_students (request_id, student_uuid)
        SELECT $1::uuid, unnest($2::uuid[])
        ON CONFLICT (request_id, student_uuid) DO NOTHING
      `,
      [requestId, studentUuids],
    );
  }

  async insertEvent(
    input: {
      requestId: string;
      actorUserId: number | null;
      action: string;
      metadata?: Record<string, unknown> | null;
      ip?: string | null;
    },
    executor: SqlQueryExecutor,
  ): Promise<void> {
    await executor.query(
      `
        INSERT INTO pii_export_events (request_id, actor_user_id, action, metadata, ip)
        VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
      `,
      [
        input.requestId,
        input.actorUserId,
        input.action,
        JSON.stringify(input.metadata ?? {}),
        input.ip ?? null,
      ],
    );
  }

  async listRequests(input: {
    actorUserId: number;
    actorScope: DataScope;
    isApprover: boolean;
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: PiiExportRequestRow[]; totalCount: number }> {
    const params: unknown[] = [input.actorUserId];
    const conditions = ['(request.requester_user_id = $1'];
    if (input.isApprover) {
      if (input.actorScope.global === true) {
        conditions[0] += ` OR request.status = 'PENDING'`;
      } else {
        const scopeClauses: string[] = [
          `COALESCE((request.scope_snapshot->>'global')::boolean, false) = false`,
        ];
        const addScopeClause = (key: keyof DataScope) => {
          const actorValues = normalizeScopeArray(input.actorScope[key]);
          if (actorValues.length === 0) {
            return;
          }
          params.push(actorValues);
          const paramIndex = params.length;
          scopeClauses.push(`
            request.scope_snapshot ? '${key}'
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(request.scope_snapshot->'${key}') AS requested(value)
              WHERE requested.value <> ALL($${paramIndex}::text[])
            )
          `);
        };
        addScopeClause('provinces');
        addScopeClause('districts');
        addScopeClause('sub_districts');
        addScopeClause('school_ids');
        addScopeClause('grade_levels');
        addScopeClause('room_ids');
        if (scopeClauses.length > 1) {
          conditions[0] += ` OR (request.status = 'PENDING' AND ${scopeClauses.join(' AND ')})`;
        }
      }
    }
    conditions[0] += ')';
    if (input.status) {
      params.push(input.status);
      conditions.push(`request.status = $${params.length}`);
    }
    params.push(input.limit);
    const limitIndex = params.length;
    params.push((input.page - 1) * input.limit);
    const offsetIndex = params.length;

    const result = await this.query<PiiExportRequestRow>(
      `
        SELECT
          request.*,
          requester.username AS requester_username,
          concat_ws(' ', requester."FirstName", requester."LastName") AS requester_name,
          approver.username AS approver_username,
          concat_ws(' ', approver."FirstName", approver."LastName") AS approver_name,
          COUNT(selected.student_uuid)::int AS selected_student_count,
          COUNT(*) OVER()::int AS total_count
        FROM pii_export_requests request
        JOIN users requester ON requester.id = request.requester_user_id
        LEFT JOIN users approver ON approver.id = request.approver_user_id
        LEFT JOIN pii_export_request_students selected ON selected.request_id = request.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY request.id, requester.id, approver.id
        ORDER BY request.created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    return {
      rows: result.rows,
      totalCount: Number(result.rows[0]?.total_count ?? 0),
    };
  }

  async findRequestById(id: string): Promise<PiiExportRequestRow | null> {
    const result = await this.query<PiiExportRequestRow>(
      `
        SELECT
          request.*,
          requester.username AS requester_username,
          concat_ws(' ', requester."FirstName", requester."LastName") AS requester_name,
          approver.username AS approver_username,
          concat_ws(' ', approver."FirstName", approver."LastName") AS approver_name,
          COUNT(selected.student_uuid)::int AS selected_student_count
        FROM pii_export_requests request
        JOIN users requester ON requester.id = request.requester_user_id
        LEFT JOIN users approver ON approver.id = request.approver_user_id
        LEFT JOIN pii_export_request_students selected ON selected.request_id = request.id
        WHERE request.id = $1::uuid
        GROUP BY request.id, requester.id, approver.id
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async approveRequest(
    input: {
      id: string;
      approverUserId: number;
      downloadTokenHash: string;
      expiresAt: Date;
    },
    executor: SqlQueryExecutor,
  ): Promise<PiiExportRequestRow | null> {
    const result = await executor.query<PiiExportRequestRow>(
      `
        UPDATE pii_export_requests
        SET status = 'APPROVED',
            approver_user_id = $2,
            download_token_hash = $3,
            download_expires_at = $4,
            updated_at = now()
        WHERE id = $1::uuid
          AND status = 'PENDING'
        RETURNING *
      `,
      [input.id, input.approverUserId, input.downloadTokenHash, input.expiresAt.toISOString()],
    );
    return result.rows[0] ?? null;
  }

  async rejectRequest(
    input: { id: string; approverUserId: number; reason: string },
    executor: SqlQueryExecutor,
  ): Promise<PiiExportRequestRow | null> {
    const result = await executor.query<PiiExportRequestRow>(
      `
        UPDATE pii_export_requests
        SET status = 'REJECTED',
            approver_user_id = $2,
            rejected_reason = $3,
            updated_at = now()
        WHERE id = $1::uuid
          AND status = 'PENDING'
        RETURNING *
      `,
      [input.id, input.approverUserId, input.reason],
    );
    return result.rows[0] ?? null;
  }

  async claimDownload(
    tokenHash: string,
    executor: SqlQueryExecutor,
  ): Promise<PiiExportRequestRow | null> {
    const result = await executor.query<PiiExportRequestRow>(
      `
        UPDATE pii_export_requests
        SET status = 'DOWNLOADED',
            downloaded_at = now(),
            updated_at = now()
        WHERE download_token_hash = $1
          AND status = 'APPROVED'
          AND downloaded_at IS NULL
          AND download_expires_at > now()
        RETURNING *
      `,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async findRequestByTokenHash(tokenHash: string): Promise<PiiExportRequestRow | null> {
    const result = await this.query<PiiExportRequestRow>(
      `SELECT * FROM pii_export_requests WHERE download_token_hash = $1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async countRequestStudents(requestId: string): Promise<number> {
    const result = await this.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM pii_export_request_students
        WHERE request_id = $1::uuid
      `,
      [requestId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listStudentsForExport(
    scope: DataScope,
    requestId?: string,
  ): Promise<PiiExportStudentRow[]> {
    const where = this.studentScopeWhere(scope);
    const selectedJoin = requestId
      ? `
        JOIN pii_export_request_students selected
          ON selected.student_uuid = s.student_uuid
         AND selected.request_id = $${where.params.length + 1}::uuid
      `
      : '';
    const params = requestId ? [...where.params, requestId] : where.params;
    const result = await this.query<PiiExportStudentRow>(
      `
        SELECT
          s."PersonID_Onec",
          s."PassportNumber_Onec",
          s."FirstName_Onec",
          s."LastName_Onec",
          s."SchoolID_Onec",
          sc.name AS school_name,
          gl.label AS grade,
          s."RoomID_Onec",
          COALESCE(ss.label_th, 'ยังไม่ได้จับคู่') AS student_status_label,
          s."VillageNumber_Onec",
          s."Trok_Onec",
          s."Soi_Onec",
          s."Street_Onec",
          s."SubDistrictNameThai_Onec",
          s."DistrictNameThai_Onec",
          s."ProvinceNameThai_Onec",
          s."PostalCode_Onec"
        FROM student_term s
        ${selectedJoin}
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN student_status ss
          ON ss.code = COALESCE(s.student_status_code, s."StudentStatusID_Onec")
        ${where.sql}
        ORDER BY s."SchoolID_Onec", s."GradeLevelID_Onec", s."RoomID_Onec", s."PersonID_Onec"
        LIMIT 10000
      `,
      params,
    );
    return result.rows;
  }

  async claimExpiredRequests(
    now: Date,
    executor: SqlQueryExecutor,
  ): Promise<PiiExportRequestRow[]> {
    const result = await executor.query<PiiExportRequestRow>(
      `
        UPDATE pii_export_requests
        SET status = 'EXPIRED',
            updated_at = now()
        WHERE status = 'APPROVED'
          AND downloaded_at IS NULL
          AND download_expires_at <= $1::timestamptz
        RETURNING *
      `,
      [now.toISOString()],
    );
    return result.rows;
  }
}
