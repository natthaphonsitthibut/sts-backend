import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AuthenticatedRequestUser } from '../auth';
import { nlQueryConfig } from '../config/nl-query.config';
import type { NlQueryDto, QueryEnvelope, SchemaResponse } from './dto/nl-query.dto';
import { NlQueryLogService } from './nl-query-log.service';

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class NlQueryService {
  private readonly logger = new Logger(NlQueryService.name);
  private schemaCache: { value: SchemaResponse; expiresAt: number } | null = null;

  constructor(
    @Inject(nlQueryConfig.KEY)
    private readonly config: ConfigType<typeof nlQueryConfig>,
    private readonly log: NlQueryLogService,
  ) {}

  async query(dto: NlQueryDto, user: AuthenticatedRequestUser): Promise<QueryEnvelope> {
    const startedAt = Date.now();
    let logId: string;

    try {
      logId = await this.log.begin({
        userId: user.id,
        // TODO(pdpa): this scope is audit-only; generated SQL/results are not scoped in v1.
        dataScope: user.data_scope ?? null,
        question: dto.question,
      });
    } catch (error) {
      this.logError('nl_query_log.begin failed', error);
      throw new ServiceUnavailableException('ระบบบันทึกการใช้งานไม่พร้อม กรุณาลองใหม่');
    }

    let envelope: QueryEnvelope;
    try {
      envelope = await this.fetchJson<QueryEnvelope>('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: dto.question,
          preferred_chart_type: dto.preferredChartType ?? null,
        }),
      });
    } catch (error) {
      try {
        await this.log.fail(logId, String(error));
      } catch (logError) {
        this.logError(`nl_query_log.fail failed (logId=${logId})`, logError);
      }
      throw new BadGatewayException('บริการวิเคราะห์ข้อมูลไม่พร้อมใช้งาน');
    }

    try {
      await this.log.complete(logId, {
        requestId: envelope.request_id,
        sql: envelope.sql,
        status: envelope.status,
        errorCode: envelope.error?.code ?? null,
        rowCount: envelope.row_count,
        retryCount: envelope.retry_count,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logError(`nl_query_log.complete failed (logId=${logId})`, error);
    }

    return envelope;
  }

  async schema(): Promise<SchemaResponse> {
    const now = Date.now();
    if (this.schemaCache && this.schemaCache.expiresAt > now) {
      return this.schemaCache.value;
    }

    try {
      const value = await this.fetchJson<SchemaResponse>('/api/schema', { method: 'GET' });
      this.schemaCache = { value, expiresAt: now + SCHEMA_CACHE_TTL_MS };
      return value;
    } catch {
      throw new BadGatewayException('บริการวิเคราะห์ข้อมูลไม่พร้อมใช้งาน');
    }
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.url}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          'X-API-Key': this.config.apiKey,
        },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`upstream ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private logError(message: string, error: unknown): void {
    this.logger.error(message, error instanceof Error ? error.stack : String(error));
  }
}
