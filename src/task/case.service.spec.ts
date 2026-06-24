import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
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
      | 'withTransaction'
      | 'insertCaseReview'
      | 'findEligibleReferralAgency'
      | 'insertCaseReferral'
      | 'listCaseReferrals'
      | 'updateCaseStatus'
      | 'findCaseReviewById'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  beforeEach(() => {
    taskRepository = {
      findCaseById: jest.fn().mockResolvedValue({ id: 10, school_id: 10010002 }),
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      insertCaseReview: jest.fn().mockResolvedValue(undefined),
      findEligibleReferralAgency: jest.fn().mockResolvedValue({
        id: 20,
        name: 'โรงพยาบาลทดสอบ',
        agency_type: 'HOSPITAL',
      }),
      insertCaseReferral: jest.fn().mockResolvedValue(undefined),
      listCaseReferrals: jest.fn().mockResolvedValue([
        {
          id: 'referral-id',
          case_id: 10,
          agency_id: 20,
          agency_name_snapshot: 'โรงพยาบาลทดสอบ',
          agency_type_snapshot: 'HOSPITAL',
        },
      ]),
      updateCaseStatus: jest.fn().mockResolvedValue(undefined),
      findCaseReviewById: jest.fn().mockResolvedValue({
        id: 'review-id',
        case_id: 10,
        review_action: 'ASSIST',
        reviewed_by: 'ผอ. ทดสอบ',
      }),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new CaseService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService({} as TaskRepository),
      auditLog as unknown as AuditLogService,
    );
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

  it('allows FORWARD only with forward-case permission', async () => {
    const result = await service.reviewCase(
      10,
      { review_action: 'FORWARD', review_note: 'ส่งต่อหน่วยงาน', agency_id: 20 },
      buildActor(['review-cases', 'forward-case']),
    );

    expect(result.case_status).toBe('AWAITING_HELP');
    expect(taskRepository.insertCaseReferral).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        agencyId: 20,
        agencyName: 'โรงพยาบาลทดสอบ',
        agencyType: 'HOSPITAL',
        referralNote: 'ส่งต่อหน่วยงาน',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_FORWARD',
        targetType: 'case',
        targetId: '10',
      }),
    );
  });

  it('rejects FORWARD without an agency before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'FORWARD', review_note: 'ส่งต่อหน่วยงาน' },
        buildActor(['review-cases', 'forward-case']),
      ),
    ).rejects.toThrow('agency_id is required for FORWARD');

    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
    expect(taskRepository.insertCaseReferral).not.toHaveBeenCalled();
  });
});
