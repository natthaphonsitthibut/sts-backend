import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { DataScope } from '../auth';
import { NlQueryLog, type NlQueryLogStatus } from './entities/nl-query-log.entity';

export interface BeginNlQueryLogInput {
  userId: number;
  dataScope: DataScope | null;
  question: string;
}

export interface CompleteNlQueryLogInput {
  requestId: string;
  sql: string | null;
  status: Extract<NlQueryLogStatus, 'ok' | 'error'>;
  errorCode: string | null;
  rowCount: number;
  retryCount: number;
  elapsedMs: number;
}

@Injectable()
export class NlQueryLogService {
  constructor(
    @InjectRepository(NlQueryLog)
    private readonly repository: Repository<NlQueryLog>,
  ) {}

  async begin(input: BeginNlQueryLogInput): Promise<string> {
    // TODO(pdpa): redact the question before persistence and apply retention.
    const saved = await this.repository.save(
      this.repository.create({
        userId: input.userId,
        dataScope: input.dataScope,
        question: input.question,
        status: 'pending',
      }),
    );
    return saved.id;
  }

  async complete(id: string, input: CompleteNlQueryLogInput): Promise<void> {
    await this.repository.update(id, {
      requestId: input.requestId,
      sql: input.sql,
      status: input.status,
      errorCode: input.errorCode,
      rowCount: input.rowCount,
      retryCount: input.retryCount,
      elapsedMs: input.elapsedMs,
      completedAt: new Date(),
    });
  }

  async fail(id: string, detail: string): Promise<void> {
    await this.repository.update(id, {
      status: 'failed',
      errorDetail: detail,
      completedAt: new Date(),
    });
  }
}
