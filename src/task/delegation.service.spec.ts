import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskAccessService } from './task-access.service';
import { DelegationService } from './delegation.service';
import { TaskRepository } from './task.repository';
import type { QueryExecutor } from './task.types';

type TransactionCallback = (executor: QueryExecutor) => Promise<unknown>;

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr'),
}));

describe('DelegationService', () => {
  let service: DelegationService;
  let taskAccessService: jest.Mocked<Pick<TaskAccessService, 'getTaskByToken'>>;
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'createDelegatedTaskLink'
      | 'findDelegationLinkByTokenHash'
      | 'lockDelegationLinkForUpdate'
      | 'transitionTaskLinkStatus'
      | 'withTransaction'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let parentStatus: string;
  let childCount: number;
  let transactionTail: Promise<void>;

  beforeEach(() => {
    parentStatus = 'ACTIVE';
    childCount = 0;
    transactionTail = Promise.resolve();

    taskAccessService = {
      getTaskByToken: jest.fn().mockResolvedValue({
        task_type: 'VISIT',
        auth_required: false,
        can_delegate: true,
      }),
    };
    taskRepository = {
      findDelegationLinkByTokenHash: jest.fn().mockResolvedValue({ id: 'parent-link' }),
      lockDelegationLinkForUpdate: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 'parent-link',
          task_id: 'task-id',
          assigned_to_name: 'ผู้รับเดิม',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          status: parentStatus,
          admin_locked: false,
          delegation_depth: 0,
          max_delegation_depth: 3,
        }),
      ),
      transitionTaskLinkStatus: jest.fn().mockImplementation(() => {
        if (parentStatus !== 'ACTIVE') {
          return Promise.resolve(false);
        }
        parentStatus = 'DELEGATED';
        return Promise.resolve(true);
      }),
      createDelegatedTaskLink: jest.fn().mockImplementation(() => {
        childCount += 1;
        return Promise.resolve();
      }),
      withTransaction: jest.fn().mockImplementation(async (callback: TransactionCallback) => {
        const previous = transactionTail;
        let release: () => void = () => undefined;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const statusBeforeTransaction = parentStatus;
        const childCountBeforeTransaction = childCount;
        try {
          const executor = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          } as unknown as QueryExecutor;
          return await callback(executor);
        } catch (error) {
          parentStatus = statusBeforeTransaction;
          childCount = childCountBeforeTransaction;
          throw error;
        } finally {
          release();
        }
      }),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new DelegationService(
      taskRepository as unknown as TaskRepository,
      taskAccessService as unknown as TaskAccessService,
      auditLog as unknown as AuditLogService,
    );
  });

  it('rejects delegation before database access when OTP authentication is required', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: true,
      can_delegate: true,
    });

    await expect(
      service.delegateTask(
        'public-token',
        { new_assignee_name: 'ผู้รับใหม่', expires_in_hours: 24 },
        'http://localhost:5173',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskRepository.findDelegationLinkByTokenHash).not.toHaveBeenCalled();
  });

  it('passes the magic session through validation and delegates atomically', async () => {
    const result = await service.delegateTask(
      'public-token',
      { new_assignee_name: 'ผู้รับใหม่', expires_in_hours: 24 },
      'http://localhost:5173',
      'verified-session',
    );

    expect(taskAccessService.getTaskByToken).toHaveBeenCalledWith(
      'public-token',
      'verified-session',
    );
    expect(taskRepository.lockDelegationLinkForUpdate).toHaveBeenCalled();
    expect(taskRepository.transitionTaskLinkStatus).toHaveBeenCalledWith(
      'parent-link',
      'ACTIVE',
      'DELEGATED',
      expect.anything(),
    );
    expect(taskRepository.createDelegatedTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({
        parentLinkId: 'parent-link',
        taskId: 'task-id',
        delegationDepth: 1,
      }),
      expect.anything(),
    );
    expect(result.delegation_depth).toBe(1);
    expect(parentStatus).toBe('DELEGATED');
    expect(childCount).toBe(1);
    expect(auditLog.record).toHaveBeenCalledTimes(1);
  });

  it('allows only one child when two delegation requests race', async () => {
    const requests = [
      service.delegateTask(
        'public-token',
        { new_assignee_name: 'ผู้รับใหม่ A', expires_in_hours: 24 },
        'http://localhost:5173',
        'verified-session',
      ),
      service.delegateTask(
        'public-token',
        { new_assignee_name: 'ผู้รับใหม่ B', expires_in_hours: 24 },
        'http://localhost:5173',
        'verified-session',
      ),
    ];

    const results = await Promise.allSettled(requests);
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.reason).toBeInstanceOf(ConflictException);
    expect(childCount).toBe(1);
    expect(auditLog.record).toHaveBeenCalledTimes(1);
  });

  it('rolls back the parent transition when child creation fails', async () => {
    taskRepository.createDelegatedTaskLink.mockRejectedValueOnce(new Error('insert failed'));

    await expect(
      service.delegateTask(
        'public-token',
        { new_assignee_name: 'ผู้รับใหม่', expires_in_hours: 24 },
        'http://localhost:5173',
        'verified-session',
      ),
    ).rejects.toThrow('insert failed');

    expect(parentStatus).toBe('ACTIVE');
    expect(childCount).toBe(0);
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
