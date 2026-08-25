import { registerAs } from '@nestjs/config';

export interface QueueRuntimeConfig {
  redisUrl?: string;
  requireRedis: boolean;
  failedJobRetention: {
    ageSeconds: number;
    count: number;
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
    // Failed jobs are the only queue entries nothing removes on its own. Redis
    // runs with noeviction, so an unbounded tail eventually refuses new writes
    // instead of quietly dropping old keys; the failure detail also reaches the
    // application log, so keeping it in Redis forever buys nothing.
    failedJobRetention: {
      ageSeconds: parsePositiveInt(process.env.QUEUE_FAILED_RETENTION_SECONDS, 7 * 24 * 60 * 60),
      count: parsePositiveInt(process.env.QUEUE_FAILED_RETENTION_COUNT, 1_000),
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
