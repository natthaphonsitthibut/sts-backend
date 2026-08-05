import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PasswordService } from '../auth/password.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import {
  StudentAccountBatchRepository,
  type BatchJobRow,
} from './student-account-batch.repository';
import { StudentAccountBatchService } from './student-account-batch.service';
import type { ActorContext, QueryExecutor, StudentAccountCandidateRow } from './users.types';

const actor: ActorContext = {
  id: 5,
  username: 'school-admin',
  roles: ['ADMIN_SCHOOL'],
  permissions: ['manage-student-accounts'],
  data_scope: { school_ids: [10010002] },
};

const candidate: StudentAccountCandidateRow = {
  student_uuid: '00000000-0000-4000-8000-000000000001',
  person_uuid: '11111111-1111-4111-8111-111111111111',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  school_id: 10010002,
  school_name: 'โรงเรียนทดสอบ',
  grade_label: 'ม.6',
  grade_level_id: 6,
  room_id: 1,
  academic_year: 2569,
  semester: 1,
  existing_user_id: null,
  existing_username: null,
};

function makeJob(overrides: Partial<BatchJobRow> = {}): BatchJobRow {
  return {
    id: 'job-1',
    status: 'PENDING',
    created_by: 5,
    scope_snapshot: { actorScope: actor.data_scope, schoolId: 10010002 },
    total_candidates: 1,
    processed_count: 0,
    created_count: 0,
    skipped_count: 0,
    failed_count: 0,
    error_summary: null,
    started_at: null,
    finished_at: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('StudentAccountBatchService', () => {
  const executor: QueryExecutor = { query: jest.fn() };
  let batchRepository: jest.Mocked<
    Pick<
      StudentAccountBatchRepository,
      | 'createJob'
      | 'findJobById'
      | 'listJobs'
      | 'claimJobForRun'
      | 'setJobStatus'
      | 'requestCancel'
      | 'markRunningJobsInterrupted'
      | 'insertItems'
      | 'syncJobCounters'
      | 'listCreatedAccounts'
      | 'withTransaction'
    >
  >;
  let usersRepository: jest.Mocked<
    Pick<
      UsersRepository,
      | 'countStudentAccountCandidates'
      | 'listStudentAccountCandidates'
      | 'usernameExists'
      | 'createUser'
      | 'reissueTemporaryPassword'
    >
  >;
  let usersPolicyService: jest.Mocked<Pick<UsersPolicyService, 'ensureActor'>>;
  let passwordService: jest.Mocked<Pick<PasswordService, 'generateTempPassword' | 'hash'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: jest.Mocked<
    Pick<
      NotificationsService,
      'notifyStudentAccountBatchCompleted' | 'notifyStudentAccountBatchFailed'
    >
  >;
  let service: StudentAccountBatchService;
  let queue: {
    add: jest.MockedFunction<(name: string, data: unknown, options: unknown) => Promise<void>>;
  };

  beforeEach(() => {
    batchRepository = {
      createJob: jest.fn().mockResolvedValue(makeJob()),
      findJobById: jest.fn().mockResolvedValue(makeJob({ status: 'RUNNING' })),
      listJobs: jest.fn().mockResolvedValue({ rows: [makeJob()], totalCount: 1 }),
      claimJobForRun: jest.fn().mockResolvedValue(makeJob({ status: 'RUNNING' })),
      setJobStatus: jest.fn().mockResolvedValue(undefined),
      requestCancel: jest.fn().mockResolvedValue(makeJob({ status: 'CANCELED' })),
      markRunningJobsInterrupted: jest.fn().mockResolvedValue(0),
      insertItems: jest.fn().mockResolvedValue(undefined),
      syncJobCounters: jest.fn().mockResolvedValue(undefined),
      listCreatedAccounts: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      withTransaction: jest.fn(
        async (callback: (executor: QueryExecutor) => Promise<unknown>) => await callback(executor),
      ),
    };
    usersRepository = {
      countStudentAccountCandidates: jest.fn().mockResolvedValue({
        totalCount: 1,
        withoutAccountCount: 1,
        existingAccountCount: 0,
      }),
      listStudentAccountCandidates: jest.fn().mockResolvedValue([]),
      usernameExists: jest.fn().mockResolvedValue(false),
      createUser: jest.fn().mockResolvedValue(77),
      reissueTemporaryPassword: jest.fn().mockResolvedValue(true),
    };
    usersPolicyService = {
      ensureActor: jest.fn().mockImplementation((value: ActorContext | undefined) => {
        if (!value) throw new ForbiddenException('ไม่ได้เข้าสู่ระบบ');
        return value;
      }),
    };
    passwordService = {
      generateTempPassword: jest.fn().mockReturnValue('Temp-1234'),
      hash: jest.fn().mockResolvedValue('hash'),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    notificationsService = {
      notifyStudentAccountBatchCompleted: jest.fn().mockResolvedValue(undefined),
      notifyStudentAccountBatchFailed: jest.fn().mockResolvedValue(undefined),
    };

    service = new StudentAccountBatchService(
      batchRepository as unknown as StudentAccountBatchRepository,
      usersRepository as unknown as UsersRepository,
      usersPolicyService as unknown as UsersPolicyService,
      passwordService as unknown as PasswordService,
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
    );
    queue = {
      add: jest.fn<Promise<void>, [string, unknown, unknown]>().mockResolvedValue(undefined),
    };
    (service as unknown as { queue: typeof queue }).queue = queue;
  });

  const flush = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it('rejects enqueue without the student-account permission', async () => {
    await expect(service.enqueue({ ...actor, permissions: [] }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(batchRepository.createJob).not.toHaveBeenCalled();
  });

  it('rejects enqueue for an own-only (student) actor', async () => {
    await expect(
      service.enqueue({ ...actor, data_scope: { own_only: true } }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enqueues a job, snapshots candidate count, and audits', async () => {
    const result = await service.enqueue(actor, { schoolId: 10010002 });
    expect(batchRepository.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 5, totalCandidates: 1 }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_ACCOUNT_BATCH_ENQUEUE' }),
    );
    const enqueueAudit = auditLog.record.mock.calls.find(
      ([input]) => input.action === 'STUDENT_ACCOUNT_BATCH_ENQUEUE',
    )?.[0];
    expect(enqueueAudit?.metadata).toEqual(
      expect.objectContaining({ schoolId: 10010002, scope: actor.data_scope }),
    );
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('job-1');
    expect(queue.add).toHaveBeenCalledWith('process', { jobId: 'job-1' }, { jobId: 'job-1' });
    expect(batchRepository.claimJobForRun).not.toHaveBeenCalled();
  });

  it('dispatches queued jobs through BullMQ', async () => {
    const bullService = new StudentAccountBatchService(
      batchRepository as unknown as StudentAccountBatchRepository,
      usersRepository as unknown as UsersRepository,
      usersPolicyService as unknown as UsersPolicyService,
      passwordService as unknown as PasswordService,
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      {
        redisUrl: 'redis://localhost:6379',
        requireRedis: false,
        studentAccountBatch: {
          queueName: 'student-account-batch-test',
          attempts: 3,
          backoffMs: 30_000,
        },
        riskProfile: {
          queueName: 'student-risk-profile-test',
          attempts: 3,
          backoffMs: 30_000,
        },
        dataExport: {
          queueName: 'data-export-test',
          attempts: 3,
          backoffMs: 30_000,
          artifactTtlHours: 24,
          storagePrefix: 'data-exports/',
        },
      },
    );
    (bullService as unknown as { queue: typeof queue }).queue = queue;

    const result = await bullService.enqueue(actor, { schoolId: 10010002 });

    expect(queue.add).toHaveBeenCalledWith('process', { jobId: 'job-1' }, { jobId: 'job-1' });
    expect(batchRepository.claimJobForRun).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('fails closed when the queue is not ready', async () => {
    (service as unknown as { queue?: typeof queue }).queue = undefined;

    await expect(service.enqueue(actor, { schoolId: 10010002 })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(batchRepository.setJobStatus).toHaveBeenCalledWith('job-1', 'FAILED', {
      errorSummary: 'Student-account batch queue is not ready',
      finished: true,
    });
    expect(batchRepository.claimJobForRun).not.toHaveBeenCalled();
  });

  it('rejects enqueue when room is specified without grade', async () => {
    await expect(service.enqueue(actor, { schoolId: 10010002, room: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(batchRepository.createJob).not.toHaveBeenCalled();
  });

  it('processes a chunk: creates account, writes CREATED item, completes', async () => {
    batchRepository.claimJobForRun.mockResolvedValue(makeJob({ status: 'RUNNING' }));
    usersRepository.listStudentAccountCandidates
      .mockResolvedValueOnce([candidate])
      .mockResolvedValue([]);

    await (service as unknown as { runJob(id: string): Promise<void> }).runJob('job-1');

    expect(usersRepository.createUser).toHaveBeenCalledTimes(1);
    expect(batchRepository.insertItems).toHaveBeenCalledWith(
      [expect.objectContaining({ status: 'CREATED', userId: 77 })],
      executor,
    );
    expect(batchRepository.syncJobCounters).toHaveBeenCalledWith('job-1');
    expect(batchRepository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'COMPLETED',
      expect.objectContaining({ finished: true }),
    );
    expect(notificationsService.notifyStudentAccountBatchCompleted).toHaveBeenCalledWith({
      jobId: 'job-1',
      actorUserId: 5,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_ACCOUNT_BATCH_COMPLETED', targetId: 'job-1' }),
    );
    const completedAudit = auditLog.record.mock.calls.find(
      ([input]) => input.action === 'STUDENT_ACCOUNT_BATCH_COMPLETED',
    )?.[0];
    expect(completedAudit?.metadata).toEqual(
      expect.objectContaining({
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        schoolId: 10010002,
        scope: actor.data_scope,
      }),
    );
    expect(notificationsService.notifyStudentAccountBatchFailed).not.toHaveBeenCalled();
  });

  it('records a duplicate as SKIPPED without aborting the batch', async () => {
    batchRepository.claimJobForRun.mockResolvedValue(makeJob({ status: 'RUNNING' }));
    usersRepository.listStudentAccountCandidates
      .mockResolvedValueOnce([candidate])
      .mockResolvedValue([]);
    usersRepository.createUser.mockRejectedValueOnce({ code: '23505' });

    await (service as unknown as { runJob(id: string): Promise<void> }).runJob('job-1');

    expect(batchRepository.insertItems).toHaveBeenCalledWith([
      expect.objectContaining({ status: 'SKIPPED', errorCode: 'DUPLICATE', userId: null }),
    ]);
    expect(batchRepository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'COMPLETED',
      expect.objectContaining({ finished: true }),
    );
    expect(notificationsService.notifyStudentAccountBatchCompleted).toHaveBeenCalled();
    expect(notificationsService.notifyStudentAccountBatchFailed).not.toHaveBeenCalled();
  });

  it('stops processing when the job is canceled mid-run', async () => {
    batchRepository.claimJobForRun.mockResolvedValue(makeJob({ status: 'RUNNING' }));
    batchRepository.findJobById.mockResolvedValue(makeJob({ status: 'CANCELED' }));

    await (service as unknown as { runJob(id: string): Promise<void> }).runJob('job-1');

    expect(usersRepository.createUser).not.toHaveBeenCalled();
    expect(batchRepository.setJobStatus).not.toHaveBeenCalledWith(
      'job-1',
      'COMPLETED',
      expect.anything(),
    );
  });

  it('marks the job FAILED when a chunk throws unexpectedly', async () => {
    batchRepository.claimJobForRun.mockResolvedValue(makeJob({ status: 'RUNNING' }));
    usersRepository.listStudentAccountCandidates.mockRejectedValue(new Error('db down'));

    await (service as unknown as { runJob(id: string): Promise<void> }).runJob('job-1');

    expect(batchRepository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'FAILED',
      expect.objectContaining({ finished: true }),
    );
    expect(notificationsService.notifyStudentAccountBatchFailed).toHaveBeenCalledWith({
      jobId: 'job-1',
      actorUserId: 5,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_ACCOUNT_BATCH_FAILED', targetId: 'job-1' }),
    );
    const failedAudit = auditLog.record.mock.calls.find(
      ([input]) => input.action === 'STUDENT_ACCOUNT_BATCH_FAILED',
    )?.[0];
    expect(failedAudit?.metadata).toEqual(
      expect.objectContaining({
        errorSummary: 'db down',
        schoolId: 10010002,
        scope: actor.data_scope,
      }),
    );
    expect(notificationsService.notifyStudentAccountBatchCompleted).not.toHaveBeenCalled();
  });

  it('does not notify failure when the FAILED status cannot be persisted', async () => {
    batchRepository.claimJobForRun.mockResolvedValue(makeJob({ status: 'RUNNING' }));
    usersRepository.listStudentAccountCandidates.mockRejectedValue(new Error('db down'));
    batchRepository.setJobStatus.mockRejectedValue(new Error('status write failed'));

    await (service as unknown as { runJob(id: string): Promise<void> }).runJob('job-1');

    expect(notificationsService.notifyStudentAccountBatchFailed).not.toHaveBeenCalled();
  });

  it('only resumes from INTERRUPTED or FAILED', async () => {
    batchRepository.findJobById.mockResolvedValue(makeJob({ status: 'RUNNING', created_by: 5 }));
    await expect(service.resume(actor, 'job-1')).rejects.toBeInstanceOf(ForbiddenException);

    batchRepository.findJobById.mockResolvedValue(
      makeJob({ status: 'INTERRUPTED', created_by: 5 }),
    );
    batchRepository.claimJobForRun.mockResolvedValue(null);
    const result = await service.resume(actor, 'job-1');
    await flush();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_ACCOUNT_BATCH_RESUME' }),
    );
    const resumeAudit = auditLog.record.mock.calls.find(
      ([input]) => input.action === 'STUDENT_ACCOUNT_BATCH_RESUME',
    )?.[0];
    expect(resumeAudit?.metadata).toEqual(
      expect.objectContaining({
        previousStatus: 'INTERRUPTED',
        schoolId: 10010002,
        scope: actor.data_scope,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('hides jobs owned by another actor from a non-super admin', async () => {
    batchRepository.findJobById.mockResolvedValue(makeJob({ created_by: 999 }));
    await expect(service.getJob(actor, 'job-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rotates temporary passwords to build a one-time credential sheet', async () => {
    batchRepository.findJobById.mockResolvedValue(makeJob({ status: 'COMPLETED', created_by: 5 }));
    batchRepository.listCreatedAccounts.mockResolvedValue({
      rows: [{ user_id: 77, username: '10010002-ABCDE', detail: { studentName: 'สมชาย ใจดี' } }],
      totalCount: 1,
    });

    const result = await service.downloadCredentials(actor, 'job-1', {});

    expect(usersRepository.reissueTemporaryPassword).toHaveBeenCalledTimes(1);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0]).toEqual(
      expect.objectContaining({ userId: 77, tempPassword: 'Temp-1234' }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_TEMP_PASSWORD_REISSUE' }),
    );
    const reissueAudit = auditLog.record.mock.calls.find(
      ([input]) => input.action === 'STUDENT_TEMP_PASSWORD_REISSUE',
    )?.[0];
    expect(reissueAudit?.metadata).toEqual(
      expect.objectContaining({ schoolId: 10010002, scope: actor.data_scope }),
    );
  });

  it('marks stale RUNNING jobs INTERRUPTED on startup', async () => {
    batchRepository.markRunningJobsInterrupted.mockResolvedValue(3);
    await service.onModuleInit();
    expect(batchRepository.markRunningJobsInterrupted).toHaveBeenCalled();
  });
});
