import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { CaseService } from './case.service';
import { CaseTrackingOptionsService } from './case-tracking-options.service';

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
      | 'transitionPendingReviewCase'
      | 'findCaseReviewById'
      | 'listTasksByCase'
      | 'listCaseReviews'
      | 'listCaseRiskSignals'
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
      transitionPendingReviewCase: jest.fn().mockResolvedValue(true),
      findCaseReviewById: jest.fn().mockResolvedValue({
        id: 'review-id',
        case_id: 10,
        review_action: 'CONTINUE',
        reviewed_by: 'ผอ. ทดสอบ',
      }),
      listTasksByCase: jest.fn().mockResolvedValue([]),
      listCaseReviews: jest.fn().mockResolvedValue([]),
      listCaseRiskSignals: jest.fn().mockResolvedValue([]),
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
      {
        getReviewAction: jest.fn((code: string) => {
          if (code === 'CONTINUE') {
            return Promise.resolve({
              code,
              label: 'ติดตามต่อ',
              targetStatus: 'IN_PROGRESS',
              requiresResolutionOutcome: false,
              requiredPermission: 'review-cases',
            });
          }
          if (code === 'CLOSE') {
            return Promise.resolve({
              code,
              label: 'ปิดเคส',
              targetStatus: 'RESOLVED',
              requiresResolutionOutcome: true,
              requiredPermission: 'close-case',
            });
          }
          throw new Error('การดำเนินการกับเคสไม่ถูกต้อง');
        }),
        assertResolutionOutcome: jest.fn((code: string | null) => Promise.resolve(code)),
      } as unknown as CaseTrackingOptionsService,
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

  it('separates system risk signals from human review history', async () => {
    taskRepository.listCaseReviews.mockResolvedValueOnce([
      {
        id: 'review-id',
        review_action: 'CONTINUE',
        review_note: 'ติดตามการมาเรียนต่อ',
        reviewer_display: 'ผอ. ทดสอบ',
        reviewed_at: '2026-07-24T00:00:00.000Z',
      },
    ]);
    taskRepository.listCaseRiskSignals.mockResolvedValueOnce([
      {
        id: 'signal-id',
        signal_source_code: 'SUBJECT_RISK_MONITOR',
        signal_rule_code: 'LOW_ATTENDANCE_PERCENT',
        signal_reason: 'เวลาเรียนต่ำกว่าเกณฑ์',
        detected_at: '2026-07-23T00:00:00.000Z',
      },
    ]);

    const result = await service.getCase(10, buildActor(['review-cases']));

    expect(result.data.reviews).toEqual([
      expect.objectContaining({
        id: 'review-id',
        reviewed_by: 'ผอ. ทดสอบ',
        review_note: 'ติดตามการมาเรียนต่อ',
      }),
    ]);
    expect(result.data.risk_signals).toEqual([
      {
        id: 'signal-id',
        source_code: 'SUBJECT_RISK_MONITOR',
        rule_code: 'LOW_ATTENDANCE_PERCENT',
        reason: 'เวลาเรียนต่ำกว่าเกณฑ์',
        detected_at: '2026-07-23T00:00:00.000Z',
      },
    ]);
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

  it('allows CONTINUE with review-cases permission and ignores client reviewed_by', async () => {
    const result = await service.reviewCase(
      10,
      {
        review_action: 'CONTINUE',
        review_note: 'ติดตามต่อ',
        reviewed_by: 'client-forged-reviewer',
      },
      buildActor(['review-cases']),
    );

    expect(result.case_status).toBe('IN_PROGRESS');
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'CONTINUE',
        reviewNote: 'ติดตามต่อ',
        reviewedBy: 'ผอ. ทดสอบ',
        sourceActorUserId: 1,
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

  it('requires a reason before recording a human review', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CONTINUE', review_note: '' },
        buildActor(['review-cases']),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
  });

  it('allows CLOSE with an outcome when the reviewer has both permissions', async () => {
    taskRepository.findCaseReviewById.mockResolvedValueOnce({
      id: 'closed-review-id',
      case_id: 10,
      review_action: 'CLOSE',
      resolution_outcome: 'RETURNED_TO_SCHOOL',
      reviewed_by: 'ผอ. ทดสอบ',
    });

    const result = await service.reviewCase(
      10,
      {
        review_action: 'CLOSE',
        review_note: 'ตรวจรายงานแล้ว ปิดเคสได้',
        resolution_outcome: 'RETURNED_TO_SCHOOL',
      },
      buildActor(['review-cases', 'close-case']),
    );

    expect(result.case_status).toBe('RESOLVED');
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalledWith(
      10,
      'RESOLVED',
      undefined,
      expect.objectContaining({ id: 1 }),
    );
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'CLOSE',
        resolutionOutcome: 'RETURNED_TO_SCHOOL',
        reviewedBy: 'ผอ. ทดสอบ',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_CLOSE',
      }),
    );
    expect(auditLog.record.mock.calls[0]?.[0].metadata).toEqual({
      reviewAction: 'CLOSE',
      resolutionOutcome: 'RETURNED_TO_SCHOOL',
    });
  });

  it('rejects CLOSE without close-case permission before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CLOSE', review_note: 'ไม่มีสิทธิ์ปิดเคส' },
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
        { review_action: 'CONTINUE', review_note: 'ไม่ควรทำได้' },
        buildActor(['review-cases'], { roles: ['EXECUTIVE'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
  });

  it('rejects CLOSE without base review-cases permission before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CLOSE', review_note: 'ไม่มีสิทธิ์พิจารณาเคส' },
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
    ).rejects.toThrow('การดำเนินการกับเคสไม่ถูกต้อง');

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
