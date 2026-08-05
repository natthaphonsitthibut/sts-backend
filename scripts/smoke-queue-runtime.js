const { Queue } = require('bullmq');
const { StudentAccountBatchService } = require('../dist/users/student-account-batch.service');
const { RiskProfileService } = require('../dist/risk-profile/risk-profile.service');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run queue runtime smoke with NODE_ENV=production');
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const studentQueueName = `sts-smoke-student-account-batch-${suffix}`;
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
    studentAccountBatch: {
      queueName: studentQueueName,
      attempts: 2,
      backoffMs: 100,
    },
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

function createStudentAccountService() {
  const batchRepository = {
    markRunningJobsInterrupted: async () => 0,
    claimJobForRun: async (jobId) => ({
      id: jobId,
      status: 'RUNNING',
      created_by: 5,
      scope_snapshot: {
        actorScope: { global: true },
        schoolId: null,
        schoolName: null,
        province: null,
        district: null,
        subDistrict: null,
        grade: null,
        room: null,
      },
      total_candidates: 0,
      processed_count: 0,
      created_count: 0,
      skipped_count: 0,
      failed_count: 0,
      error_summary: null,
      started_at: new Date(),
      finished_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    }),
    findJobById: async (jobId) => ({ id: jobId, status: 'RUNNING' }),
    syncJobCounters: async () => undefined,
    setJobStatus: async () => undefined,
    withTransaction: async (callback) => callback({ query: async () => [] }),
  };
  const usersRepository = {
    listStudentAccountCandidates: async () => [],
  };
  return {
    service: new StudentAccountBatchService(
      batchRepository,
      usersRepository,
      { ensureActor: (actor) => actor },
      {},
      { record: async () => undefined },
      {
        notifyStudentAccountBatchCompleted: async () => undefined,
        notifyStudentAccountBatchFailed: async () => undefined,
      },
      queueConfig(),
    ),
    batchRepository,
  };
}

function createRiskProfileService() {
  const repository = {
    getRiskThresholds: async () => ({
      lowConsecutiveAbsentDays: 3,
      mediumConsecutiveAbsentDays: 5,
      highConsecutiveAbsentDays: 7,
      highAttendancePercent: 80,
      subjectLateWindowDays: 10,
      subjectLateWatchCount: 4,
    }),
    recalculateAll: async () => 1,
    recalculateStudents: async () => 1,
    countMissingActiveProfiles: async () => 0,
  };
  return { service: new RiskProfileService(repository, queueConfig()), repository };
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
  await Promise.all([obliterateQueue(studentQueueName), obliterateQueue(riskQueueName)]);

  const { service: studentService, batchRepository } = createStudentAccountService();
  const { service: riskService, repository: riskRepository } = createRiskProfileService();
  const claimedJobs = [];
  const completedJobs = [];
  const riskFullRuns = [];
  const riskStudentRuns = [];

  const originalClaim = batchRepository.claimJobForRun;
  batchRepository.claimJobForRun = async (jobId) => {
    claimedJobs.push(jobId);
    return originalClaim(jobId);
  };
  batchRepository.setJobStatus = async (jobId, status) => {
    if (status === 'COMPLETED') completedJobs.push(jobId);
  };
  riskRepository.recalculateAll = async () => {
    riskFullRuns.push('full');
    return 1;
  };
  riskRepository.recalculateStudents = async (studentUuids) => {
    riskStudentRuns.push(studentUuids);
    return 1;
  };

  try {
    await studentService.onModuleInit();
    await riskService.onModuleInit();

    await studentService.dispatchJob('queue-runtime-smoke-job');
    await waitFor(
      () => claimedJobs.includes('queue-runtime-smoke-job'),
      'student-account batch job was not processed by BullMQ worker',
    );
    await waitFor(
      () => completedJobs.includes('queue-runtime-smoke-job'),
      'student-account batch job was not completed by BullMQ worker',
    );

    riskFullRuns.length = 0;
    await riskService.enqueueFull('queue-runtime-smoke');
    await waitFor(() => riskFullRuns.length > 0, 'risk full job was not processed by BullMQ worker');

    await riskService.enqueueStudents(['student-a', 'student-a', 'student-b'], 'queue-runtime-smoke');
    await waitFor(
      () => riskStudentRuns.some((ids) => ids.join(',') === 'student-a,student-b'),
      'risk student job was not processed by BullMQ worker',
    );

    assert(claimedJobs.length >= 1, 'student queue did not claim a job');
    assert(riskFullRuns.length >= 1, 'risk queue did not run full recalculation');
    assert(riskStudentRuns.length >= 1, 'risk queue did not run student recalculation');

    console.log('smoke:queue-runtime ok');
  } finally {
    await Promise.allSettled([
      studentService.onApplicationShutdown(),
      riskService.onApplicationShutdown(),
    ]);
    await Promise.allSettled([obliterateQueue(studentQueueName), obliterateQueue(riskQueueName)]);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
