import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { CaseService } from './case.service';

function buildActor(
  permissions: string[],
  overrides: Partial<AuthenticatedRequestUser> = {},
): AuthenticatedRequestUser {
  return {
    id: 1,
    username: 'director',
    roles: ['DIRECTOR'],
    permissions,
    data_scope: { school_ids: [10010002] },
    FirstName: 'ผอ.',
    LastName: 'ทดสอบ',
    ...overrides,
  };
}

describe('CaseService', () => {
  let service: CaseService;
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'findCaseById'
      | 'findCaseDetailById'
      | 'findStudentForCaseCreation'
      | 'findActiveCaseByStudentUuid'
      | 'createCase'
      | 'withTransaction'
      | 'insertCaseReview'
      | 'updateCaseStatus'
      | 'findCaseReviewById'
      | 'claimCaseSlaWarnings'
      | 'claimCaseSlaBreaches'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: { [k: string]: jest.Mock };

  beforeEach(() => {
    taskRepository = {
      findCaseById: jest.fn().mockResolvedValue({ id: 10, school_id: 10010002 }),
      findCaseDetailById: jest.fn().mockResolvedValue({
        id: 10,
        student_id: '11111111-1111-4111-8111-111111111111',
        student_name: 'เด็ก ทดสอบ',
        student_school: 'โรงเรียนทดสอบ',
        reason_flagged: 'ต้องติดตาม',
        status: 'OPEN',
        school_id: 10010002,
      }),
      findStudentForCaseCreation: jest.fn().mockResolvedValue({
        student_uuid: '11111111-1111-4111-8111-111111111111',
        FirstName_Onec: 'เด็ก',
        LastName_Onec: 'ทดสอบ',
        school_id: 10010002,
        school_name: 'โรงเรียนทดสอบ',
      }),
      findActiveCaseByStudentUuid: jest.fn().mockResolvedValue(null),
      createCase: jest.fn().mockResolvedValue(10),
      withTransaction: jest.fn(async (callback) => await callback(undefined)),
      insertCaseReview: jest.fn().mockResolvedValue(undefined),
      updateCaseStatus: jest.fn().mockResolvedValue(undefined),
      findCaseReviewById: jest.fn().mockResolvedValue({
        id: 'review-id',
        case_id: 10,
        review_action: 'ASSIST',
        reviewed_by: 'ผอ. ทดสอบ',
      }),
      claimCaseSlaWarnings: jest.fn().mockResolvedValue([]),
      claimCaseSlaBreaches: jest.fn().mockResolvedValue([]),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notifyCaseStatusChanged: jest.fn().mockResolvedValue(undefined),
      notifyCaseCreated: jest.fn().mockResolvedValue(undefined),
      notifyCaseSlaWarning: jest.fn().mockResolvedValue(undefined),
      notifyCaseSlaBreached: jest.fn().mockResolvedValue(undefined),
    };

    service = new CaseService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService({} as TaskRepository),
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
    );
  });

  it('opens one scoped case from the authoritative student record', async () => {
    const studentId = '11111111-1111-4111-8111-111111111111';
    const actor = buildActor(['review-cases']);

    const result = await service.openCase(
      { student_id: studentId, reason: '  ต้องติดตามเรื่องการมาเรียน  ' },
      actor,
    );

    expect(result.created).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ id: 10, status: 'OPEN' }));
    expect(taskRepository.findStudentForCaseCreation).toHaveBeenCalledWith(
      studentId,
      actor,
      undefined,
    );
    expect(taskRepository.createCase).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUuid: studentId,
        schoolId: 10010002,
        reasonFlagged: 'ต้องติดตามเรื่องการมาเรียน',
        createdBy: 1,
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_CREATE', targetId: '10' }),
    );
    expect(notificationsService.notifyCaseCreated).toHaveBeenCalled();
  });

  it('returns the existing active case instead of creating a duplicate', async () => {
    taskRepository.findActiveCaseByStudentUuid.mockResolvedValueOnce({ id: 10 });

    const result = await service.openCase(
      {
        student_id: '11111111-1111-4111-8111-111111111111',
        reason: 'ติดตามต่อ',
      },
      buildActor(['review-cases']),
    );

    expect(result.created).toBe(false);
    expect(taskRepository.createCase).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseCreated).not.toHaveBeenCalled();
  });

  it('hides an out-of-scope student when opening a case', async () => {
    taskRepository.findStudentForCaseCreation.mockResolvedValueOnce(null);

    await expect(
      service.openCase(
        {
          student_id: '11111111-1111-4111-8111-111111111111',
          reason: 'ติดตามต่อ',
        },
        buildActor(['review-cases']),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(taskRepository.createCase).not.toHaveBeenCalled();
  });

  it('rejects opening a case without review-cases permission', async () => {
    await expect(
      service.openCase(
        {
          student_id: '11111111-1111-4111-8111-111111111111',
          reason: 'ติดตามต่อ',
        },
        buildActor(['students']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('allows ASSIST with review-cases permission and ignores client reviewed_by', async () => {
    const result = await service.reviewCase(
      10,
      {
        review_action: 'ASSIST',
        review_note: 'ติดตามต่อ',
        reviewed_by: 'client-forged-reviewer',
      },
      buildActor(['review-cases']),
    );

    expect(result.case_status).toBe('IN_PROGRESS');
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'ASSIST',
        reviewNote: 'ติดตามต่อ',
        reviewedBy: 'ผอ. ทดสอบ',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_REVIEW',
        targetType: 'case',
        targetId: '10',
      }),
    );
  });

  it('rejects CLOSE without close-case permission before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CLOSE', review_note: null },
        buildActor(['review-cases']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('denies case mutation to an EXECUTIVE even when raw permissions are re-granted', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'ASSIST', review_note: 'ไม่ควรทำได้' },
        buildActor(['review-cases'], { roles: ['EXECUTIVE'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
  });

  it('rejects CLOSE without base review-cases permission before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CLOSE', review_note: null },
        buildActor(['close-case']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects the retired FORWARD action before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'FORWARD', review_note: 'legacy request' },
        buildActor(['review-cases']),
      ),
    ).rejects.toThrow('review_action must be one of: ASSIST, CLOSE');

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('notifies claimed case SLA warnings and breaches once', async () => {
    const dueAt = new Date('2026-07-10T00:00:00.000Z');
    taskRepository.claimCaseSlaWarnings.mockResolvedValueOnce([
      {
        id: 101,
        student_name: 'สมชาย ใจดี',
        school_id: 10010002,
        risk_tier: 'MEDIUM',
        sla_due_at: dueAt,
      },
    ]);
    taskRepository.claimCaseSlaBreaches.mockResolvedValueOnce([
      {
        id: 102,
        student_name: 'สมหญิง ดีใจ',
        school_id: 10010002,
        risk_tier: 'HIGH',
        sla_due_at: dueAt,
      },
    ]);

    const result = await service.remindCaseSla(new Date('2026-07-09T00:00:00.000Z'));

    expect(result).toEqual({ warned: 1, breached: 1 });
    expect(notificationsService.notifyCaseSlaWarning).toHaveBeenCalledWith({
      caseId: 101,
      studentName: 'สมชาย ใจดี',
      schoolId: 10010002,
      riskTier: 'MEDIUM',
      dueAt,
    });
    expect(notificationsService.notifyCaseSlaBreached).toHaveBeenCalledWith({
      caseId: 102,
      studentName: 'สมหญิง ดีใจ',
      schoolId: 10010002,
      riskTier: 'HIGH',
      dueAt,
    });
    expect(auditLog.record).not.toHaveBeenCalled();

    taskRepository.claimCaseSlaWarnings.mockResolvedValueOnce([]);
    taskRepository.claimCaseSlaBreaches.mockResolvedValueOnce([]);
    await expect(service.remindCaseSla(new Date('2026-07-09T00:00:00.000Z'))).resolves.toEqual({
      warned: 0,
      breached: 0,
    });
  });
});
