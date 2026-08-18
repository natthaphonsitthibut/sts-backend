import { RiskProfileRepository } from './risk-profile.repository';
import { RiskProfileService } from './risk-profile.service';

/**
 * Minimal in-memory stand-in for the Redis commands the coalescing path uses.
 * Modelling RENAME plus the atomic scheduling-marker release is what lets the
 * "event arrives mid-drain" case be asserted rather than assumed.
 */
class FakeRedis {
  sets = new Map<string, Set<string>>();
  strings = new Map<string, string>();

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return Promise.resolve(members.length);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  scard(key: string): Promise<number> {
    return Promise.resolve(this.sets.get(key)?.size ?? 0);
  }

  del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.sets.delete(key)) deleted += 1;
      if (this.strings.delete(key)) deleted += 1;
    }
    return Promise.resolve(deleted);
  }

  set(key: string, value: string, ...options: Array<string | number>): Promise<'OK' | null> {
    if (options.includes('NX') && this.strings.has(key)) return Promise.resolve(null);
    this.strings.set(key, value);
    return Promise.resolve('OK');
  }

  eval(
    _script: string,
    _numberOfKeys: number,
    dirtyStudentsKey: string,
    dirtyFullKey: string,
    scheduledKey: string,
  ): Promise<number> {
    if ((this.sets.get(dirtyStudentsKey)?.size ?? 0) > 0 || this.strings.has(dirtyFullKey)) {
      return Promise.resolve(1);
    }
    this.strings.delete(scheduledKey);
    return Promise.resolve(0);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.strings.get(key) ?? null);
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.strings.has(key) || this.sets.has(key) ? 1 : 0);
  }

  rename(from: string, to: string): Promise<'OK'> {
    const set = this.sets.get(from);
    const value = this.strings.get(from);
    if (!set && value === undefined) {
      // Matches Redis: RENAME on a missing key is an error, which the drain
      // treats as "no student work pending".
      return Promise.reject(new Error('ERR no such key'));
    }
    this.sets.delete(to);
    this.strings.delete(to);
    if (set) {
      this.sets.set(to, set);
      this.sets.delete(from);
    } else {
      this.strings.set(to, value!);
      this.strings.delete(from);
    }
    return Promise.resolve('OK');
  }
}

describe('RiskProfileService', () => {
  let repository: jest.Mocked<
    Pick<
      RiskProfileRepository,
      | 'getRiskThresholds'
      | 'recalculateAll'
      | 'recalculateStudents'
      | 'listMissingActiveProfileStudentUuids'
    >
  >;
  let service: RiskProfileService;
  let redis: FakeRedis;
  let queue: {
    add: jest.MockedFunction<(name: string, data: unknown, options: unknown) => Promise<void>>;
  };

  beforeEach(() => {
    repository = {
      getRiskThresholds: jest.fn().mockResolvedValue({
        lowConsecutiveAbsentDays: 3,
        mediumConsecutiveAbsentDays: 5,
        highConsecutiveAbsentDays: 7,
        highAttendancePercent: 80,
        subjectLateWindowDays: 10,
        subjectLateWatchCount: 4,
      }),
      recalculateAll: jest.fn().mockResolvedValue({ evaluated: 10, changed: 0, skipped: 10 }),
      recalculateStudents: jest.fn().mockResolvedValue({ evaluated: 2, changed: 1, skipped: 1 }),
      listMissingActiveProfileStudentUuids: jest.fn().mockResolvedValue([]),
    };
    redis = new FakeRedis();
    queue = {
      add: jest.fn<Promise<void>, [string, unknown, unknown]>().mockResolvedValue(undefined),
    };
    service = new RiskProfileService(repository as unknown as RiskProfileRepository, undefined, {
      getClient: () => redis,
    } as never);
    (service as unknown as { queue: typeof queue }).queue = queue;
  });

  async function runDrain(reason = 'test'): Promise<void> {
    await (service as unknown as { processJob: (job: unknown) => Promise<void> }).processJob({
      kind: 'drain',
      reason,
    });
  }

  it('coalesces repeated events for the same cohort into one drain job', async () => {
    for (let index = 0; index < 100; index += 1) {
      await service.enqueueStudents(['student-1', 'student-2'], 'attendance-save');
    }

    // The Redis scheduling marker admits one BullMQ job for the entire burst.
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0]?.[2]).not.toHaveProperty('jobId');
    expect(await redis.scard('risk-profile:dirty:students')).toBe(2);
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
  });

  it('carries no student identifiers in the queue payload', async () => {
    await service.enqueueStudents(['student-1'], 'attendance-save');

    expect(queue.add).toHaveBeenCalledWith(
      'drain',
      { kind: 'drain', reason: 'attendance-save' },
      { delay: 2_000 },
    );
    const payload = JSON.stringify(queue.add.mock.calls[0]?.[1]);
    expect(payload).not.toContain('student-1');
  });

  it('recalculates the claimed cohort in bounded batches', async () => {
    await service.enqueueStudents(['student-1', 'student-2'], 'attendance-save');
    queue.add.mockClear();

    await runDrain();

    expect(repository.recalculateStudents).toHaveBeenCalledTimes(1);
    expect(repository.recalculateStudents.mock.calls[0][0].sort()).toEqual([
      'student-1',
      'student-2',
    ]);
    // Nothing left dirty, so no follow-up drain is scheduled.
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not lose an event that arrives while a drain is running', async () => {
    await service.enqueueStudents(['student-1'], 'attendance-save');
    queue.add.mockClear();

    // The event lands after the drain claimed its set, mimicking a save that
    // commits mid-run.
    repository.recalculateStudents.mockImplementationOnce(async () => {
      await service.enqueueStudents(['student-late'], 'attendance-save');
      return { evaluated: 1, changed: 1, skipped: 0 };
    });

    await runDrain();

    // The late student is still pending and a follow-up drain was scheduled.
    expect(await redis.smembers('risk-profile:dirty:students')).toEqual(['student-late']);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'drain',
      { kind: 'drain', reason: 'drain-followup' },
      { delay: 2_000 },
    );

    queue.add.mockClear();
    await runDrain();
    expect(repository.recalculateStudents).toHaveBeenLastCalledWith(
      ['student-late'],
      expect.any(Object),
    );
  });

  it('keeps a claimed generation for BullMQ retry when recalculation fails', async () => {
    await service.enqueueStudents(['student-1'], 'attendance-save');
    repository.recalculateStudents.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(runDrain()).rejects.toThrow('database unavailable');
    expect(await redis.smembers('risk-profile:draining:students')).toEqual(['student-1']);

    await runDrain();
    expect(repository.recalculateStudents).toHaveBeenLastCalledWith(
      ['student-1'],
      expect.any(Object),
    );
    expect(await redis.scard('risk-profile:draining:students')).toBe(0);
  });

  it('does not swallow Redis failures while reading a claimed generation', async () => {
    await service.enqueueStudents(['student-1'], 'attendance-save');
    jest.spyOn(redis, 'smembers').mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(runDrain()).rejects.toThrow('redis unavailable');
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
    expect(await redis.scard('risk-profile:draining:students')).toBe(1);
  });

  it('lets a full pass subsume pending student work instead of doing both', async () => {
    await service.enqueueStudents(['student-1'], 'attendance-save');
    await service.enqueueFull('setting-change:CASE_RISK_LOW_ABSENCE_DAYS');

    await runDrain();

    expect(repository.recalculateAll).toHaveBeenCalledTimes(1);
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
    // The claimed student set is consumed, not left to trigger a second pass.
    expect(await redis.scard('risk-profile:dirty:students')).toBe(0);
  });

  it('does nothing when the drain finds no pending work', async () => {
    await runDrain();

    expect(repository.getRiskThresholds).not.toHaveBeenCalled();
    expect(repository.recalculateAll).not.toHaveBeenCalled();
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
  });

  it('repairs only missing profiles on startup instead of recalculating everything', async () => {
    repository.listMissingActiveProfileStudentUuids
      .mockResolvedValueOnce(['student-missing'])
      .mockResolvedValueOnce([]);

    await service.repairMissingProfiles('startup-repair');

    expect(repository.listMissingActiveProfileStudentUuids).toHaveBeenCalledWith(500);
    expect(repository.recalculateAll).not.toHaveBeenCalled();
    expect(repository.getRiskThresholds).toHaveBeenCalledTimes(1);
    expect(repository.recalculateStudents).toHaveBeenCalledWith(
      ['student-missing'],
      expect.any(Object),
    );
    expect(await redis.smembers('risk-profile:dirty:students')).toEqual([]);
  });

  it('queues a background full pass when missing profiles exceed the startup batch', async () => {
    service = new RiskProfileService(
      repository as unknown as RiskProfileRepository,
      {
        redisUrl: 'redis://placeholder',
        requireRedis: true,
        riskProfile: { queueName: 'student-risk-profile', attempts: 3, backoffMs: 30_000 },
        dataExport: { queueName: 'data-export', attempts: 3, backoffMs: 30_000 },
      },
      { getClient: () => redis } as never,
    );
    (service as unknown as { queue: typeof queue }).queue = queue;
    repository.listMissingActiveProfileStudentUuids
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => `student-${index}`))
      .mockResolvedValueOnce(['student-remaining']);

    await service.repairMissingProfiles('startup-repair');

    expect(repository.recalculateStudents).toHaveBeenCalledWith(
      expect.arrayContaining(['student-0', 'student-499']),
      expect.any(Object),
    );
    expect(await redis.get('risk-profile:dirty:full')).toBe(
      'startup-repair:remaining-missing-profiles',
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(repository.recalculateAll).not.toHaveBeenCalled();
  });

  it('stays idle on startup when no profile is missing', async () => {
    await service.repairMissingProfiles('startup-repair');

    expect(queue.add).not.toHaveBeenCalled();
    expect(repository.getRiskThresholds).not.toHaveBeenCalled();
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
    expect(repository.recalculateAll).not.toHaveBeenCalled();
  });

  it('fails startup instead of serving with missing risk profiles when repair fails', async () => {
    repository.listMissingActiveProfileStudentUuids.mockRejectedValueOnce(
      new Error('statement timeout'),
    );

    await expect(service.onModuleInit()).rejects.toThrow('statement timeout');
  });

  it('keeps events in Redis when the queue is unavailable so repair can recover them', async () => {
    (service as unknown as { queue?: typeof queue }).queue = undefined;

    await expect(service.enqueueStudents(['student-1'], 'attendance-save')).rejects.toThrow(
      'Risk profile queue is not ready',
    );

    // The student is already marked dirty, and the bounded repair path is the
    // safety net for anything that never made it onto the queue.
    expect(await redis.smembers('risk-profile:dirty:students')).toEqual(['student-1']);
    expect(repository.recalculateStudents).not.toHaveBeenCalled();
  });

  it('releases the scheduling marker when the initial queue add fails', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.enqueueStudents(['student-1'], 'attendance-save')).rejects.toThrow(
      'queue unavailable',
    );
    await service.enqueueStudents(['student-1'], 'attendance-save');

    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Redis is unavailable', async () => {
    service = new RiskProfileService(repository as unknown as RiskProfileRepository, undefined, {
      getClient: () => undefined,
    } as never);
    (service as unknown as { queue: typeof queue }).queue = queue;

    await expect(service.enqueueFull('settings-change')).rejects.toThrow(
      'Risk profile queue is not ready',
    );
    expect(repository.recalculateAll).not.toHaveBeenCalled();
  });

  it('logs counts and reason without any student identifier', async () => {
    const logs: string[] = [];
    jest
      .spyOn((service as unknown as { logger: { log: (message: string) => void } }).logger, 'log')
      .mockImplementation((message: string) => {
        logs.push(message);
      });

    await service.enqueueStudents(['00000000-0000-4000-8000-000000000001'], 'attendance-save');
    await runDrain('attendance-save');

    const drainLog = logs.find((entry) => entry.includes('drain(students)'));
    expect(drainLog).toContain('evaluated=2');
    expect(drainLog).toContain('changed=1');
    expect(drainLog).toContain('skipped=1');
    expect(drainLog).toContain('batchSize=500');
    expect(drainLog).toContain('reason=attendance-save');
    expect(drainLog).not.toContain('00000000-0000-4000-8000-000000000001');
  });
});
