const { Queue } = require('bullmq');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');
const { RedisClientService } = require('../dist/redis/redis-client.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run queue runtime smoke with NODE_ENV=production');
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const riskQueueName = `sts-smoke-risk-profile-${suffix}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError ? `${message}: ${lastError.message || lastError}` : message);
}

function queueConfig() {
  return {
    redisUrl,
    requireRedis: true,
    riskProfile: {
      queueName: riskQueueName,
      attempts: 2,
      backoffMs: 100,
    },
    dataExport: {
      queueName: 'sts-smoke-data-export-unused',
      attempts: 2,
      backoffMs: 100,
      artifactTtlHours: 24,
      storagePrefix: 'data-exports/',
    },
  };
}

function createRiskProfileService(redisClientService) {
  const repository = {
    getRiskThresholds: async () => ({ highAbsentDays: 7 }),
    recalculateAll: async () => ({ evaluated: 1, changed: 1, skipped: 0 }),
    recalculateStudents: async () => ({ evaluated: 1, changed: 1, skipped: 0 }),
    countMissingActiveProfiles: async () => 0,
    listMissingActiveProfileStudentUuids: async () => [],
  };
  return {
    service: new RiskProfileService(repository, queueConfig(), redisClientService),
    repository,
  };
}

async function obliterateQueue(queueName) {
  const queue = new Queue(queueName, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });
  try {
    await queue.waitUntilReady();
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}

async function main() {
  await obliterateQueue(riskQueueName);

  const redisClientService = new RedisClientService(queueConfig());
  await redisClientService.onModuleInit();
  const { service: riskService, repository: riskRepository } =
    createRiskProfileService(redisClientService);
  const riskFullRuns = [];
  const riskStudentRuns = [];

  riskRepository.recalculateAll = async () => {
    riskFullRuns.push('full');
    return { evaluated: 1, changed: 1, skipped: 0 };
  };
  riskRepository.recalculateStudents = async (studentUuids) => {
    riskStudentRuns.push(studentUuids);
    return { evaluated: studentUuids.length, changed: studentUuids.length, skipped: 0 };
  };

  try {
    await riskService.onModuleInit();

    riskFullRuns.length = 0;
    await riskService.enqueueFull('queue-runtime-smoke');
    await waitFor(() => riskFullRuns.length > 0, 'risk full job was not processed by BullMQ worker');

    await riskService.enqueueStudents(['student-a', 'student-a', 'student-b'], 'queue-runtime-smoke');
    await waitFor(
      () => riskStudentRuns.some((ids) => ids.join(',') === 'student-a,student-b'),
      'risk student job was not processed by BullMQ worker',
    );

    assert(riskFullRuns.length >= 1, 'risk queue did not run full recalculation');
    assert(riskStudentRuns.length >= 1, 'risk queue did not run student recalculation');

    console.log('smoke:queue-runtime ok');
  } finally {
    await riskService.onApplicationShutdown();
    await redisClientService.onApplicationShutdown();
    await obliterateQueue(riskQueueName);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
