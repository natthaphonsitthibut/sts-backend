import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Queue, Worker } from 'bullmq';
import { queueConfig } from '../config/queue.config';
import { RiskProfileRepository } from './risk-profile.repository';

const DAILY_FULL_RECALC_CRON = '0 10 5 * * *';

type RiskProfileJob =
  | {
      kind: 'students';
      studentUuids: string[];
      reason: string;
    }
  | {
      kind: 'full';
      reason: string;
    };

@Injectable()
export class RiskProfileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RiskProfileService.name);
  private readonly runningJobs = new Set<string>();
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly riskProfileRepository: RiskProfileRepository,
    @Optional()
    @Inject(queueConfig.KEY)
    private readonly runtimeQueueConfig?: ConfigType<typeof queueConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = this.queueRuntimeConfig();
    if (config.requireRedis && !config.redisUrl) {
      throw new Error('REDIS_URL is required for production queue processing');
    }
    if (config.redisUrl) {
      await this.initializeBullQueue(config);
    }
    void this.enqueueFull('startup-backfill').catch((error) => {
      this.logger.error(`Risk profile startup backfill failed: ${this.errorMessage(error)}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.closeBullQueue();
  }

  async enqueueStudents(studentUuids: string[], reason: string): Promise<void> {
    const uniqueStudentUuids = [
      ...new Set(studentUuids.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueStudentUuids.length === 0) {
      return;
    }
    await this.dispatchJob({ kind: 'students', studentUuids: uniqueStudentUuids, reason });
  }

  async enqueueFull(reason: string): Promise<void> {
    await this.dispatchJob({ kind: 'full', reason });
  }

  @Cron(DAILY_FULL_RECALC_CRON, {
    name: 'risk-profile-full-recalculate',
    timeZone: 'Asia/Bangkok',
  })
  async recalculateAllDaily(): Promise<void> {
    await this.enqueueFull('daily-safety-net');
  }

  private queueRuntimeConfig(): ConfigType<typeof queueConfig> {
    return (
      this.runtimeQueueConfig ?? {
        redisUrl: undefined,
        requireRedis: false,
        studentAccountBatch: {
          queueName: 'student-account-batch',
          attempts: 3,
          backoffMs: 30_000,
        },
        riskProfile: {
          queueName: 'student-risk-profile',
          attempts: 3,
          backoffMs: 30_000,
        },
        dataExport: {
          queueName: 'data-export',
          attempts: 3,
          backoffMs: 30_000,
          artifactTtlHours: 24,
          storagePrefix: 'data-exports/',
        },
      }
    );
  }

  private async initializeBullQueue(config: ConfigType<typeof queueConfig>): Promise<void> {
    if (!config.redisUrl) {
      throw new Error('Redis URL is required for risk profile queue processing');
    }
    const connection = {
      url: config.redisUrl,
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue(config.riskProfile.queueName, {
      connection,
      defaultJobOptions: {
        attempts: config.riskProfile.attempts,
        backoff: { type: 'exponential', delay: config.riskProfile.backoffMs },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.worker = new Worker(
      config.riskProfile.queueName,
      async (job) => {
        await this.processJob(job.data as RiskProfileJob);
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Risk profile queue job ${job?.id ?? 'unknown'} failed: ${this.errorMessage(error)}`,
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Risk profile queue error: ${this.errorMessage(error)}`);
    });
    const queue = this.queue;
    const worker = this.worker;
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    this.logger.log(`Risk profile queue enabled (${config.riskProfile.queueName})`);
  }

  private async closeBullQueue(): Promise<void> {
    const closeResults = await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to close risk profile queue cleanly: ${this.errorMessage(result.reason)}`,
        );
      }
    }
  }

  private async dispatchJob(job: RiskProfileJob): Promise<void> {
    if (!this.queue) {
      throw new Error('Risk profile queue is not ready');
    }
    await this.queue.add(job.kind, job, { jobId: `risk-profile:${job.kind}:${randomUUID()}` });
  }

  private async processJob(job: RiskProfileJob): Promise<void> {
    const lockKey =
      job.kind === 'full' ? 'full' : `students:${[...job.studentUuids].sort().join(',')}`;
    if (this.runningJobs.has(lockKey)) {
      return;
    }
    this.runningJobs.add(lockKey);
    const startedAt = Date.now();
    try {
      const thresholds = await this.riskProfileRepository.getRiskThresholds();
      const updated =
        job.kind === 'full'
          ? await this.riskProfileRepository.recalculateAll(thresholds)
          : await this.riskProfileRepository.recalculateStudents(job.studentUuids, thresholds);
      const missing = await this.riskProfileRepository.countMissingActiveProfiles();
      if (missing > 0) {
        this.logger.warn(`Risk profile recalculation left ${missing} active enrollment(s) missing`);
      }
      this.logger.log(
        `Risk profile ${job.kind} recalculation completed: updated=${updated}, reason=${job.reason}, durationMs=${Date.now() - startedAt}`,
      );
    } finally {
      this.runningJobs.delete(lockKey);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
