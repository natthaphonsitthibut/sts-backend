import { registerAs } from '@nestjs/config';

export type StudentAccountBatchQueueMode = 'inline' | 'bullmq';

export interface QueueRuntimeConfig {
  redisUrl?: string;
  requireRedis: boolean;
  studentAccountBatch: {
    mode: StudentAccountBatchQueueMode;
    queueName: string;
    attempts: number;
    backoffMs: number;
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseQueueMode(
  value: string | undefined,
  hasRedis: boolean,
): StudentAccountBatchQueueMode {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === 'bullmq' || normalized === 'redis') {
    return 'bullmq';
  }
  if (normalized === 'inline' || normalized === 'in-process') {
    return 'inline';
  }
  return hasRedis ? 'bullmq' : 'inline';
}

export function getQueueConfigFromEnv(): QueueRuntimeConfig {
  const redisUrl = clean(process.env.REDIS_URL) ?? clean(process.env.QUEUE_REDIS_URL);
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();

  return {
    redisUrl,
    requireRedis: nodeEnv === 'production',
    studentAccountBatch: {
      mode: parseQueueMode(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_MODE, Boolean(redisUrl)),
      queueName: clean(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_NAME) ?? 'student-account-batch',
      attempts: parsePositiveInt(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_ATTEMPTS, 3),
      backoffMs: parsePositiveInt(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_BACKOFF_MS, 30_000),
    },
  };
}

export const queueConfig = registerAs('queue', () => getQueueConfigFromEnv());
