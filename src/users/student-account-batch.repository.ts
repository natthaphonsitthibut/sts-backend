import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type { QueryExecutor, QueryResultLike } from './users.types';

export type BatchJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'INTERRUPTED'
  | 'CANCELED';

export type BatchJobItemStatus = 'PENDING' | 'CREATED' | 'SKIPPED' | 'FAILED';

export interface BatchJobRow extends Record<string, unknown> {
  id: string;
  status: BatchJobStatus;
  created_by: number | null;
  scope_snapshot: Record<string, unknown>;
  total_candidates: number;
  processed_count: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  error_summary: string | null;
  started_at: string | Date | null;
  finished_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CreateBatchJobInput {
  id: string;
  createdBy: number | null;
  scopeSnapshot: Record<string, unknown>;
  totalCandidates: number;
}

export interface BatchJobItemInput {
  jobId: string;
  personUuid: string;
  userId: number | null;
  username: string | null;
  detail: Record<string, unknown> | null;
  status: BatchJobItemStatus;
  errorCode: string | null;
}

export interface BatchJobListFilters {
  createdBy?: number | null;
  status?: BatchJobStatus;
  page: number;
  limit: number;
  /** Restrict to the actor's own jobs unless they have cross-actor visibility. */
  onlyOwn?: boolean;
}

/**
 * Raw-SQL data access for the async student-account batch-generation job and its
 * per-candidate items. Mirrors the raw-query style of UsersRepository. The job
 * never stores plaintext credentials — items keep only non-secret fields.
 */
@Injectable()
export class StudentAccountBatchRepository {
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
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        await this.query<T>(sql, params),
    };
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => callback(executor));
  }

  async createJob(input: CreateBatchJobInput): Promise<BatchJobRow> {
    const result = await this.query<BatchJobRow>(
      `
        INSERT INTO student_account_batch_job (id, status, created_by, scope_snapshot, total_candidates)
        VALUES ($1, 'PENDING', $2, $3::jsonb, $4)
        RETURNING *
      `,
      [input.id, input.createdBy, JSON.stringify(input.scopeSnapshot ?? {}), input.totalCandidates],
    );
    return result.rows[0];
  }

  async findJobById(id: string, executor?: QueryExecutor): Promise<BatchJobRow | null> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<BatchJobRow>(
      `SELECT * FROM student_account_batch_job WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listJobs(
    filters: BatchJobListFilters,
  ): Promise<{ rows: BatchJobRow[]; totalCount: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.onlyOwn) {
      params.push(filters.createdBy);
      conditions.push(`created_by = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Math.max(filters.limit, 1), 100);
    const page = Math.max(filters.page, 1);
    const selectParams = [...params, limit, (page - 1) * limit];
    const [rowsResult, countResult] = await Promise.all([
      this.query<BatchJobRow>(
        `
          SELECT * FROM student_account_batch_job
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}
        `,
        selectParams,
      ),
      this.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM student_account_batch_job ${whereSql}`,
        params,
      ),
    ]);
    return {
      rows: rowsResult.rows,
      totalCount: Number(countResult.rows[0]?.count ?? 0),
    };
  }

  /**
   * Atomically move a job into RUNNING only from a resumable state. Returns the
   * updated row, or null if another worker already claimed it or it is finished.
   */
  async claimJobForRun(id: string): Promise<BatchJobRow | null> {
    const result = await this.query<BatchJobRow>(
      `
        UPDATE student_account_batch_job
        SET status = 'RUNNING',
            started_at = COALESCE(started_at, now()),
            error_summary = NULL,
            finished_at = NULL
        WHERE id = $1
          AND status IN ('PENDING', 'RUNNING', 'INTERRUPTED', 'FAILED')
        RETURNING *
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async setJobStatus(
    id: string,
    status: BatchJobStatus,
    options: { errorSummary?: string | null; finished?: boolean } = {},
  ): Promise<void> {
    await this.query(
      `
        UPDATE student_account_batch_job
        SET status = $2,
            error_summary = $3,
            finished_at = CASE WHEN $4 THEN now() ELSE finished_at END
        WHERE id = $1
      `,
      [id, status, options.errorSummary ?? null, options.finished === true],
    );
  }

  /** Request cancellation from a not-yet-finished state; the runner stops at the next chunk. */
  async requestCancel(id: string): Promise<BatchJobRow | null> {
    const result = await this.query<BatchJobRow>(
      `
        UPDATE student_account_batch_job
        SET status = 'CANCELED', finished_at = now()
        WHERE id = $1 AND status IN ('PENDING', 'RUNNING', 'INTERRUPTED')
        RETURNING *
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  /** On boot nothing is processing in-process, so any RUNNING job is stale. */
  async markRunningJobsInterrupted(): Promise<number> {
    const result = await this.query<{ id: string }>(
      `UPDATE student_account_batch_job SET status = 'INTERRUPTED' WHERE status = 'RUNNING' RETURNING id`,
    );
    return result.rows.length;
  }

  async insertItems(items: BatchJobItemInput[], executor?: QueryExecutor): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const queryExecutor = this.getExecutor(executor);
    const values: string[] = [];
    const params: unknown[] = [];
    for (const item of items) {
      const base = params.length;
      values.push(
        `($${base + 1}, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, now())`,
      );
      params.push(
        item.jobId,
        item.personUuid,
        item.userId,
        item.username,
        item.detail ? JSON.stringify(item.detail) : null,
        item.status,
        item.errorCode,
      );
    }
    await queryExecutor.query(
      `
        INSERT INTO student_account_batch_job_item
          (job_id, person_uuid, user_id, username, detail, status, error_code, processed_at)
        VALUES ${values.join(', ')}
        ON CONFLICT (job_id, person_uuid) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            username = EXCLUDED.username,
            detail = EXCLUDED.detail,
            status = EXCLUDED.status,
            error_code = EXCLUDED.error_code,
            processed_at = now()
      `,
      params,
    );
  }

  /** Recompute job counters from the durable item rows (resume-safe, no double counting). */
  async syncJobCounters(jobId: string, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(
      `
        UPDATE student_account_batch_job j
        SET created_count = c.created_count,
            skipped_count = c.skipped_count,
            failed_count = c.failed_count,
            processed_count = c.created_count + c.skipped_count + c.failed_count
        FROM (
          SELECT
            COUNT(*) FILTER (WHERE status = 'CREATED')::int AS created_count,
            COUNT(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped_count,
            COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_count
          FROM student_account_batch_job_item
          WHERE job_id = $1
        ) c
        WHERE j.id = $1
      `,
      [jobId],
    );
  }

  /** Created accounts for a job that are still ACTIVE and pending first change — the credential targets. */
  async listCreatedAccounts(
    jobId: string,
    page: number,
    limit: number,
  ): Promise<{
    rows: Array<{
      user_id: number;
      username: string;
      detail: Record<string, unknown> | null;
    }>;
    totalCount: number;
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);
    const [rowsResult, countResult] = await Promise.all([
      this.query<{ user_id: number; username: string; detail: Record<string, unknown> | null }>(
        `
          SELECT i.user_id, u.username, i.detail
          FROM student_account_batch_job_item i
          JOIN users u ON u.id = i.user_id
          WHERE i.job_id = $1 AND i.status = 'CREATED' AND i.user_id IS NOT NULL
            AND u.role = 'STUDENT' AND u.status = 'ACTIVE'
          ORDER BY i.id
          LIMIT $2 OFFSET $3
        `,
        [jobId, safeLimit, (safePage - 1) * safeLimit],
      ),
      this.query<{ count: number | string }>(
        `
          SELECT COUNT(*)::int AS count
          FROM student_account_batch_job_item i
          JOIN users u ON u.id = i.user_id
          WHERE i.job_id = $1 AND i.status = 'CREATED' AND i.user_id IS NOT NULL
            AND u.role = 'STUDENT' AND u.status = 'ACTIVE'
        `,
        [jobId],
      ),
    ]);
    return { rows: rowsResult.rows, totalCount: Number(countResult.rows[0]?.count ?? 0) };
  }
}
