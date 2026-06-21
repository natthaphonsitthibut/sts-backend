import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';

export interface AuditLogRecordInput {
  actorUserId?: number | null;
  actorLabel?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  async record(event: AuditLogRecordInput): Promise<void> {
    try {
      await queryDataSource(
        this.dataSource,
        `
          INSERT INTO audit_log (
            actor_user_id,
            actor_label,
            action,
            target_type,
            target_id,
            metadata,
            ip
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          event.actorUserId ?? null,
          event.actorLabel ?? null,
          event.action,
          event.targetType ?? null,
          event.targetId ?? null,
          event.metadata == null ? null : JSON.stringify(event.metadata),
          event.ip ?? null,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Audit log write failed for action "${event.action}": ${message}`);
    }
  }
}
