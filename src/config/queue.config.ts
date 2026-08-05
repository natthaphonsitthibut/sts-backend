import { registerAs } from '@nestjs/config';

export interface QueueRuntimeConfig {
  redisUrl?: string;
  requireRedis: boolean;
  studentAccountBatch: {
    queueName: string;
    attempts: number;
    backoffMs: number;
  };
  riskProfile: {
    queueName: string;
    attempts: number;
    backoffMs: number;
  };
  dataExport: {
    queueName: string;
    attempts: number;
    backoffMs: number;
    artifactTtlHours: number;
    storagePrefix: string;
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

export function getQueueConfigFromEnv(): QueueRuntimeConfig {
  const redisUrl = clean(process.env.REDIS_URL);
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();

  return {
    redisUrl,
    requireRedis: nodeEnv === 'production',
    studentAccountBatch: {
      queueName: clean(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_NAME) ?? 'student-account-batch',
      attempts: parsePositiveInt(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_ATTEMPTS, 3),
      backoffMs: parsePositiveInt(process.env.STUDENT_ACCOUNT_BATCH_QUEUE_BACKOFF_MS, 30_000),
    },
    riskProfile: {
      queueName: clean(process.env.RISK_PROFILE_QUEUE_NAME) ?? 'student-risk-profile',
      attempts: parsePositiveInt(process.env.RISK_PROFILE_QUEUE_ATTEMPTS, 3),
      backoffMs: parsePositiveInt(process.env.RISK_PROFILE_QUEUE_BACKOFF_MS, 30_000),
    },
    dataExport: {
      queueName: clean(process.env.DATA_EXPORT_QUEUE_NAME) ?? 'data-export',
      attempts: parsePositiveInt(process.env.DATA_EXPORT_QUEUE_ATTEMPTS, 3),
      backoffMs: parsePositiveInt(process.env.DATA_EXPORT_QUEUE_BACKOFF_MS, 30_000),
      artifactTtlHours: parsePositiveInt(process.env.DATA_EXPORT_ARTIFACT_TTL_HOURS, 24),
      storagePrefix: clean(process.env.DATA_EXPORT_STORAGE_PREFIX) ?? 'data-exports/',
    },
  };
}

export const queueConfig = registerAs('queue', () => getQueueConfigFromEnv());
