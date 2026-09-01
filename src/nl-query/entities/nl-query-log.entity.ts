import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { DataScope } from '../../auth';

export type NlQueryLogStatus = 'pending' | 'ok' | 'error' | 'failed';

@Entity({ name: 'nl_query_log' })
export class NlQueryLog {
  @PrimaryGeneratedColumn('increment', { name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'user_id', type: 'integer', nullable: true })
  userId!: number | null;

  @Column({ name: 'data_scope', type: 'jsonb', nullable: true })
  dataScope!: DataScope | null;

  @Column({ name: 'question', type: 'text' })
  question!: string;

  @Column({ name: 'status', type: 'varchar', length: 12 })
  status!: NlQueryLogStatus;

  @Column({ name: 'request_id', type: 'varchar', nullable: true })
  requestId!: string | null;

  @Column({ name: 'sql', type: 'text', nullable: true })
  sql!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 32, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail!: string | null;

  @Column({ name: 'row_count', type: 'integer', nullable: true })
  rowCount!: number | null;

  @Column({ name: 'retry_count', type: 'integer', nullable: true })
  retryCount!: number | null;

  @Column({ name: 'elapsed_ms', type: 'integer', nullable: true })
  elapsedMs!: number | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
