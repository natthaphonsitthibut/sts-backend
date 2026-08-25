import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Queue, Worker } from 'bullmq';
import { CronJob } from 'cron';
import type { Redis } from 'ioredis';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { queueConfig } from '../config/queue.config';
import { RedisClientService } from '../redis/redis-client.service';
import { RiskProfileRepository } from './risk-profile.repository';

/** Operator-tunable wall-clock time (HH:MM) of the daily safety-net recalculation. */
const RECALC_SCHEDULE_SETTING_KEY = 'RISK_RECALC_SCHEDULE_TIME';
/** Used when the setting is missing or unreadable, so the safety net still runs. */
const DEFAULT_RECALC_SCHEDULE_TIME = '05:10';
const RECALC_CRON_JOB_NAME = 'risk-profile-full-recalculate';

/** At or below this many students, recalculate inline so the change is visible at once. */
const INLINE_RECALCULATION_LIMIT = 5;

/** Debounce window: events for the same student inside it collapse into one drain. */
const DRAIN_DELAY_MS = 2_000;
/** Upper bound on students recalculated per drain, so one burst cannot monopolise PostgreSQL. */
const DRAIN_BATCH_SIZE = 500;
/** Upper bound on missing profiles repaired per startup/reconciliation pass. */
const REPAIR_BATCH_SIZE = 500;

const DIRTY_STUDENTS_KEY = 'risk-profile:dirty:students';
const DIRTY_FULL_KEY = 'risk-profile:dirty:full';
/** Working key the drain renames the dirty set to, so new events land in a fresh set. */
const DRAINING_STUDENTS_KEY = 'risk-profile:draining:students';
const DRAINING_FULL_KEY = 'risk-profile:draining:full';
/** Redis marker coalescing queue adds while a delayed/active drain already exists. */
const DRAIN_SCHEDULED_KEY = 'risk-profile:drain:scheduled';
// Short lease recovers a process crash between SET NX and queue.add. Expiry can
// create an extra drain, but recalculation and generation cleanup are idempotent.
const DRAIN_SCHEDULE_TTL_MS = 5 * 60 * 1_000;
const RELEASE_OR_RESCHEDULE_SCRIPT = `
  if redis.call('SCARD', KEYS[1]) > 0 or redis.call('EXISTS', KEYS[2]) == 1 then
    return 1
  end
  redis.call('DEL', KEYS[3])
  return 0
`;

type RiskProfileJob = { kind: 'drain'; reason: string };

/**
 * Coalesces risk recalculation instead of running one job per domain event.
 *
 * Events mark students dirty in a Redis set and schedule a single debounced
 * drain through a leased Redis scheduling marker. The drain
 * *renames* the dirty set before reading it: anything enqueued while the worker
 * is running lands in a brand-new set and schedules the next drain, so an event
 * arriving mid-run is delayed, never lost. The drain re-checks the set on the way
 * out and reschedules itself if more work appeared.
 *
 * Job payloads carry no student data at all — the identifiers live in Redis and
 * the payload is only a reason string, so nothing sensitive reaches the queue.
 */
@Injectable()
export class RiskProfileService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RiskProfileService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly riskProfileRepository: RiskProfileRepository,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Optional()
    @Inject(queueConfig.KEY)
    private readonly runtimeQueueConfig?: ConfigType<typeof queueConfig>,
    @Optional()
    private readonly redisClientService?: RedisClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = this.queueRuntimeConfig();
    if (config.requireRedis && !config.redisUrl) {
      throw new Error('REDIS_URL is required for production queue processing');
    }
    if (config.redisUrl) {
      await this.initializeBullQueue(config);
    }
    // Startup repairs only what is actually missing, in a bounded batch. A full
    // recalculation on every boot rewrote every profile for no domain reason.
    try {
      await this.repairMissingProfiles('startup-repair');
    } catch (error) {
      this.logger.error(`Risk profile startup repair failed: ${this.errorMessage(error)}`);
      throw error;
    }
    await this.refreshDailyRecalcCron();
  }

  async onApplicationShutdown(): Promise<void> {
    this.removeDailyRecalcCron();
    await this.closeBullQueue();
  }

  async enqueueStudents(studentUuids: string[], reason: string): Promise<void> {
    const uniqueStudentUuids = [
      ...new Set(studentUuids.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueStudentUuids.length === 0) {
      return;
    }
    const redis = this.requireRedis();
    await redis.sadd(DIRTY_STUDENTS_KEY, ...uniqueStudentUuids);
    await this.scheduleDrain(reason);
  }

  /**
   * Queue a recalculation, but never let a missing queue silently drop it: a
   * deployment without Redis (or one whose queue has not come up yet) still has
   * to reflect a change the user just made, so the fallback recalculates those
   * students inline. Callers pass a handful of students, not the whole school.
   */
  async requestStudentRecalculation(studentUuids: string[], reason: string): Promise<void> {
    const uniqueStudentUuids = [
      ...new Set(studentUuids.map((value) => value.trim()).filter(Boolean)),
    ];
    if (uniqueStudentUuids.length === 0) {
      return;
    }
    // A teacher comment or a saved round is a change the person who made it
    // expects to see straight away, and those touch a handful of students at
    // most. Recalculate those inline; the debounced queue stays for the bulk
    // paths, where waiting is fine and hammering PostgreSQL is not.
    if (uniqueStudentUuids.length > INLINE_RECALCULATION_LIMIT) {
      try {
        await this.enqueueStudents(uniqueStudentUuids, reason);
        return;
      } catch (error) {
        this.logger.warn(
          `Risk profile queue unavailable (${this.errorMessage(error)}); recalculating ${uniqueStudentUuids.length} student(s) inline for ${reason}`,
        );
      }
    }
    const thresholds = await this.riskProfileRepository.getRiskThresholds();
    const result = await this.riskProfileRepository.recalculateStudents(
      uniqueStudentUuids,
      thresholds,
    );
    this.logger.log(
      `Risk profile inline recalculation: evaluated=${result.evaluated}, changed=${result.changed}, reason=${reason}`,
    );
  }

  async enqueueFull(reason: string): Promise<void> {
    const redis = this.requireRedis();
    await redis.set(DIRTY_FULL_KEY, reason);
    await this.scheduleDrain(reason);
  }

  async recalculateAllDaily(): Promise<void> {
    await this.enqueueFull('daily-safety-net');
  }

  /**
   * (Re)registers the daily safety-net recalculation from its system setting.
   * Registration is dynamic rather than a `@Cron` decorator because a decorator
   * binds its schedule at import time, before the setting can be read.
   */
  async refreshDailyRecalcCron(): Promise<void> {
    let scheduleTime = DEFAULT_RECALC_SCHEDULE_TIME;
    try {
      scheduleTime =
        (await this.riskProfileRepository.getSystemSettingValue(RECALC_SCHEDULE_SETTING_KEY)) ??
        DEFAULT_RECALC_SCHEDULE_TIME;
    } catch (error) {
      this.logger.error(
        `Failed to read ${RECALC_SCHEDULE_SETTING_KEY}, using ${DEFAULT_RECALC_SCHEDULE_TIME}: ${this.errorMessage(error)}`,
      );
    }

    const cronTime = this.toDailyCronTime(scheduleTime);
    this.removeDailyRecalcCron();

    const job = CronJob.from({
      cronTime,
      timeZone: BANGKOK_TIME_ZONE,
      onTick: () => {
        void this.recalculateAllDaily().catch((error) => {
          this.logger.error(`Daily risk profile recalculation failed: ${this.errorMessage(error)}`);
        });
      },
    });
    this.schedulerRegistry.addCronJob(RECALC_CRON_JOB_NAME, job);
    job.start();
    this.logger.log(
      `Registered daily risk profile recalculation at ${cronTime} (${BANGKOK_TIME_ZONE})`,
    );
  }

  /** Converts an `HH:MM` setting into a cron expression, falling back when invalid. */
  private toDailyCronTime(scheduleTime: string): string {
    const [rawHour, rawMinute] = scheduleTime.trim().split(':');
    const hour = Number.parseInt(rawHour ?? '', 10);
    const minute = Number.parseInt(rawMinute ?? '', 10);
    const validHour = Number.isInteger(hour) && hour >= 0 && hour <= 23;
    const validMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59;
    if (!validHour || !validMinute) {
      this.logger.error(
        `Invalid ${RECALC_SCHEDULE_SETTING_KEY} value "${scheduleTime}". Expected HH:MM. Using ${DEFAULT_RECALC_SCHEDULE_TIME}.`,
      );
      const [fallbackHour, fallbackMinute] = DEFAULT_RECALC_SCHEDULE_TIME.split(':');
      return `0 ${Number(fallbackMinute)} ${Number(fallbackHour)} * * *`;
    }
    return `0 ${minute} ${hour} * * *`;
  }

  private removeDailyRecalcCron(): void {
    if (this.schedulerRegistry.doesExist('cron', RECALC_CRON_JOB_NAME)) {
      this.schedulerRegistry.deleteCronJob(RECALC_CRON_JOB_NAME);
    }
  }

  /**
   * Safety net for events dropped while Redis or the queue was unavailable:
   * enrollments with no profile row are recalculated in a bounded batch.
   */
  async repairMissingProfiles(reason: string): Promise<void> {
    const missing =
      await this.riskProfileRepository.listMissingActiveProfileStudentUuids(REPAIR_BATCH_SIZE);
    if (missing.length === 0) {
      return;
    }
    this.logger.log(
      `Risk profile startup repair: missing=${missing.length}, reason=${reason}, batchSize=${REPAIR_BATCH_SIZE}`,
    );
    const thresholds = await this.riskProfileRepository.getRiskThresholds();
    const result = await this.riskProfileRepository.recalculateStudents(missing, thresholds);
    this.logger.log(
      `Risk profile startup repair completed: evaluated=${result.evaluated}, changed=${result.changed}, reason=${reason}`,
    );

    const remaining =
      await this.riskProfileRepository.listMissingActiveProfileStudentUuids(REPAIR_BATCH_SIZE);
    if (remaining.length === 0) {
      return;
    }
    if (!this.queueRuntimeConfig().redisUrl || !this.queue) {
      this.logger.warn(
        `Risk profile startup repair remains incomplete: remainingBatch=${remaining.length}, reason=${reason}`,
      );
      return;
    }
    await this.enqueueFull(`${reason}:remaining-missing-profiles`);
    this.logger.log(
      `Risk profile full recalculation queued after bounded startup repair: remainingBatch=${remaining.length}, reason=${reason}`,
    );
  }

  private requireRedis(): Redis {
    const redis = this.redisClientService?.getClient();
    if (!redis) {
      throw new Error('Risk profile queue is not ready');
    }
    return redis;
  }

  private queueRuntimeConfig(): ConfigType<typeof queueConfig> {
    return (
      this.runtimeQueueConfig ?? {
        redisUrl: undefined,
        requireRedis: false,
        failedJobRetention: {
          ageSeconds: 7 * 24 * 60 * 60,
          count: 1_000,
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
        removeOnFail: {
          age: config.failedJobRetention.ageSeconds,
          count: config.failedJobRetention.count,
        },
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

  /** Redis SET NX owns coalescing; BullMQ job ids are intentionally omitted. */
  private async scheduleDrain(reason: string): Promise<void> {
    if (!this.queue) {
      throw new Error('Risk profile queue is not ready');
    }
    const redis = this.requireRedis();
    const claimed = await redis.set(DRAIN_SCHEDULED_KEY, '1', 'PX', DRAIN_SCHEDULE_TTL_MS, 'NX');
    if (claimed !== 'OK') return;
    try {
      await this.addDrainJob(reason);
    } catch (error) {
      await redis.del(DRAIN_SCHEDULED_KEY);
      throw error;
    }
  }

  private async addDrainJob(reason: string): Promise<void> {
    if (!this.queue) throw new Error('Risk profile queue is not ready');
    await this.queue.add('drain', { kind: 'drain', reason } satisfies RiskProfileJob, {
      delay: DRAIN_DELAY_MS,
    });
  }

  private async processJob(job: RiskProfileJob): Promise<void> {
    if (job.kind !== 'drain') {
      return;
    }
    const redis = this.requireRedis();
    const startedAt = Date.now();

    // A claimed generation stays under the draining keys until every database
    // write succeeds. BullMQ retries therefore resume the same work instead of
    // acknowledging it before processing. New events continue landing in the
    // dirty keys and are picked up by the next generation.
    const fullReason = await this.claimFullGeneration(redis);
    const claimedStudents = await this.claimStudentGeneration(redis);

    if (!fullReason && claimedStudents.length === 0) {
      await this.releaseOrRescheduleDrain(redis);
      return;
    }

    const thresholds = await this.riskProfileRepository.getRiskThresholds();
    let evaluated = 0;
    let changed = 0;
    let batches = 0;

    if (fullReason) {
      // A full pass already covers every dirty student, so the claimed set is
      // dropped rather than recalculated twice.
      const result = await this.riskProfileRepository.recalculateAll(thresholds);
      evaluated += result.evaluated;
      changed += result.changed;
      batches += 1;
      this.logger.log(
        `Risk profile drain(full) completed: evaluated=${result.evaluated}, changed=${result.changed}, skipped=${result.skipped}, reason=${fullReason}, durationMs=${Date.now() - startedAt}`,
      );
    } else {
      for (let index = 0; index < claimedStudents.length; index += DRAIN_BATCH_SIZE) {
        const batch = claimedStudents.slice(index, index + DRAIN_BATCH_SIZE);
        const result = await this.riskProfileRepository.recalculateStudents(batch, thresholds);
        evaluated += result.evaluated;
        changed += result.changed;
        batches += 1;
      }
      this.logger.log(
        `Risk profile drain(students) completed: evaluated=${evaluated}, changed=${changed}, skipped=${evaluated - changed}, batches=${batches}, batchSize=${DRAIN_BATCH_SIZE}, reason=${job.reason}, durationMs=${Date.now() - startedAt}`,
      );
    }

    // Ack only after successful recalculation. If Redis fails here the job is
    // retried; recalculation is idempotent, so duplicate work is safer than loss.
    await redis.del(DRAINING_FULL_KEY, DRAINING_STUDENTS_KEY);

    // Work that arrived while this drain was running gets its own cycle.
    await this.releaseOrRescheduleDrain(redis);
  }

  private async claimFullGeneration(redis: Redis): Promise<string | null> {
    const existing = await redis.get(DRAINING_FULL_KEY);
    if (existing) return existing;
    try {
      await redis.rename(DIRTY_FULL_KEY, DRAINING_FULL_KEY);
      return await redis.get(DRAINING_FULL_KEY);
    } catch (error) {
      if (this.isMissingRedisKey(error)) return null;
      throw error;
    }
  }

  private async claimStudentGeneration(redis: Redis): Promise<string[]> {
    if ((await redis.exists(DRAINING_STUDENTS_KEY)) === 0) {
      try {
        await redis.rename(DIRTY_STUDENTS_KEY, DRAINING_STUDENTS_KEY);
      } catch (error) {
        if (!this.isMissingRedisKey(error)) throw error;
      }
    }
    return await redis.smembers(DRAINING_STUDENTS_KEY);
  }

  private async releaseOrRescheduleDrain(redis: Redis): Promise<void> {
    const hasPendingWork = Number(
      await redis.eval(
        RELEASE_OR_RESCHEDULE_SCRIPT,
        3,
        DIRTY_STUDENTS_KEY,
        DIRTY_FULL_KEY,
        DRAIN_SCHEDULED_KEY,
      ),
    );
    if (hasPendingWork === 1) await this.addDrainJob('drain-followup');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isMissingRedisKey(error: unknown): boolean {
    return error instanceof Error && error.message.includes('no such key');
  }
}
