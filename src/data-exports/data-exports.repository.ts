import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type {
  DataExportJobRow,
  DataExportJobStatus,
  DataExportSensitivityClass,
} from './data-export.types';

interface CreateJobInput {
  id: string;
  datasetCode: string;
  fieldBundleCode: string;
  sensitivityClass: DataExportSensitivityClass;
  requestedBy: number;
  scopeSnapshot: Record<string, unknown>;
  filterSnapshot: Record<string, unknown>;
  purposeCode: string | null;
  purposeNote: string | null;
}

interface CompleteJobInput {
  rowCount: number;
  artifactSizeBytes: number;
  artifactStorageKey: string;
  artifactSha256: string;
  expiresAt: Date;
}

@Injectable()
export class DataExportsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  async createJob(input: CreateJobInput): Promise<DataExportJobRow> {
    const result = await this.query<DataExportJobRow>(
      `
        INSERT INTO data_export_job (
          id, dataset_code, field_bundle_code, output_format, sensitivity_class,
          requested_by, scope_snapshot, filter_snapshot, purpose_code, purpose_note
        )
        VALUES ($1, $2, $3, 'CSV', $4, $5, $6::jsonb, $7::jsonb, $8, $9)
        RETURNING *
      `,
      [
        input.id,
        input.datasetCode,
        input.fieldBundleCode,
        input.sensitivityClass,
        input.requestedBy,
        JSON.stringify(input.scopeSnapshot),
        JSON.stringify(input.filterSnapshot),
        input.purposeCode,
        input.purposeNote,
      ],
    );
    return result.rows[0];
  }

  async addEvent(
    jobId: string,
    actorUserId: number | null,
    eventCode: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.query(
      `
        INSERT INTO data_export_job_event (job_id, actor_user_id, event_code, metadata)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [jobId, actorUserId, eventCode, JSON.stringify(metadata)],
    );
  }

  async listJobs(input: {
    requestedBy: number;
    status?: DataExportJobStatus;
    page: number;
    limit: number;
  }): Promise<{ rows: DataExportJobRow[]; totalCount: number }> {
    const offset = (input.page - 1) * input.limit;
    const params: unknown[] = [input.requestedBy];
    const conditions = ['requested_by = $1'];
    if (input.status) {
      params.push(input.status);
      conditions.push(`status = $${params.length}`);
    }
    params.push(input.limit, offset);
    const result = await this.query<DataExportJobRow & { total_count: number | string }>(
      `
        SELECT *, COUNT(*) OVER()::int AS total_count
        FROM data_export_job
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return {
      rows: result.rows,
      totalCount: Number(result.rows[0]?.total_count ?? 0),
    };
  }

  async findJobById(jobId: string): Promise<DataExportJobRow | null> {
    const result = await this.query<DataExportJobRow>(
      `SELECT * FROM data_export_job WHERE id = $1 LIMIT 1`,
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  async claimJob(jobId: string): Promise<DataExportJobRow | null> {
    const result = await this.query<DataExportJobRow>(
      `
        UPDATE data_export_job
        SET status = 'RUNNING', started_at = COALESCE(started_at, now()), progress_percent = 5
        WHERE id = $1
          AND status IN ('PENDING', 'FAILED')
        RETURNING *
      `,
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  async completeJob(jobId: string, input: CompleteJobInput): Promise<DataExportJobRow | null> {
    const result = await this.query<DataExportJobRow>(
      `
        UPDATE data_export_job
        SET status = 'COMPLETED',
            exported_row_count = $2,
            artifact_size_bytes = $3,
            artifact_storage_key = $4,
            artifact_sha256 = $5,
            expires_at = $6,
            completed_at = now(),
            progress_percent = 100,
            failure_code = NULL,
            failure_summary = NULL
        WHERE id = $1
          AND status = 'RUNNING'
        RETURNING *
      `,
      [
        jobId,
        input.rowCount,
        input.artifactSizeBytes,
        input.artifactStorageKey,
        input.artifactSha256,
        input.expiresAt,
      ],
    );
    return result.rows[0] ?? null;
  }

  async failJob(jobId: string, failureCode: string, failureSummary: string): Promise<boolean> {
    const result = await this.query<DataExportJobRow>(
      `
        UPDATE data_export_job
        SET status = 'FAILED',
            failure_code = $2,
            failure_summary = $3,
            completed_at = now(),
            progress_percent = 100
        WHERE id = $1
          AND status IN ('PENDING', 'RUNNING')
        RETURNING *
      `,
      [jobId, failureCode, failureSummary],
    );
    return result.rows.length > 0;
  }

  async cancelJob(jobId: string): Promise<DataExportJobRow | null> {
    const result = await this.query<DataExportJobRow>(
      `
        UPDATE data_export_job
        SET status = 'CANCELED', canceled_at = now(), progress_percent = 100
        WHERE id = $1
          AND status = 'PENDING'
        RETURNING *
      `,
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  async prepareRetry(jobId: string): Promise<DataExportJobRow | null> {
    const result = await this.query<DataExportJobRow>(
      `
        UPDATE data_export_job
        SET status = 'PENDING',
            progress_percent = 0,
            failure_code = NULL,
            failure_summary = NULL,
            started_at = NULL,
            completed_at = NULL,
            canceled_at = NULL
        WHERE id = $1
          AND status = 'FAILED'
        RETURNING *
      `,
      [jobId],
    );
    return result.rows[0] ?? null;
  }
}
