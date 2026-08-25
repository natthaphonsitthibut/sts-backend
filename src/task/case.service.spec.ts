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
      | 'insertCaseReviewAssistanceMeasures'
      | 'findActiveReferralAgency'
      | 'insertCaseReferral'
      | 'transitionPendingReviewCase'
      | 'findCaseReviewById'
      | 'listTasksByCase'
      | 'listCaseReviews'
      | 'listCaseRiskSignals'
      | 'listCaseReferrals'
      | 'listActiveReferralAgencies'
      | 'claimCaseSlaWarnings'
      | 'claimCaseSlaBreaches'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let notificationsService: { [k: string]: jest.Mock };

  beforeEach(() => {
    taskRepository = {
      findCaseById: jest.fn().mockResolvedValue({
        id: 10,
        school_id: 10010002,
        student_uuid: '11111111-1111-4111-8111-111111111111',
      }),
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
      insertCaseReviewAssistanceMeasures: jest.fn().mockResolvedValue(undefined),
      findActiveReferralAgency: jest.fn().mockResolvedValue({
        id: 12,
        agency_name: 'โรงพยาบาลกลาง',
      }),
      insertCaseReferral: jest.fn().mockResolvedValue(undefined),
      transitionPendingReviewCase: jest.fn().mockResolvedValue(true),
      findCaseReviewById: jest.fn().mockResolvedValue({
        id: 'review-id',
        case_id: 10,
        review_action: 'REFER_AGENCY',
        reviewed_by: 'ผอ. ทดสอบ',
      }),
      listTasksByCase: jest.fn().mockResolvedValue([]),
      listCaseReviews: jest.fn().mockResolvedValue([]),
      listCaseRiskSignals: jest.fn().mockResolvedValue([]),
      listCaseReferrals: jest.fn().mockResolvedValue([]),
      listActiveReferralAgencies: jest.fn().mockResolvedValue([]),
      claimCaseSlaWarnings: jest.fn().mockResolvedValue([]),
      claimCaseSlaBreaches: jest.fn().mockResolvedValue([]),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notifyCaseStatusChanged: jest.fn().mockResolvedValue(undefined),
    };

    service = new CaseService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService({} as TaskRepository),
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      {
        getReviewAction: jest.fn((code: string) => {
          if (code === 'REFER_AGENCY') {
            return Promise.resolve({
              code,
              label: 'ส่งต่อหน่วยงาน',
              targetStatus: 'RESOLVED',
              requiresResolutionOutcome: false,
              completionOutcomeCode: 'REFERRED_AGENCY',
              requiredPermission: 'dashboard',
              availablePhaseCode: null,
              targetWorkflowPhaseCode: null,
            });
          }
          if (code === 'CLOSE') {
            return Promise.resolve({
              code,
              label: 'ปิดเคส',
              targetStatus: 'RESOLVED',
              requiresResolutionOutcome: false,
              completionOutcomeCode: 'CLOSED',
              requiredPermission: 'dashboard',
              availablePhaseCode: null,
              targetWorkflowPhaseCode: null,
            });
          }
          if (code === 'ASSIST') {
            return Promise.resolve({
              code,
              label: 'ให้ความช่วยเหลือ',
              targetStatus: 'OPEN',
              requiresResolutionOutcome: false,
              completionOutcomeCode: null,
              requiredPermission: 'dashboard',
              availablePhaseCode: null,
              targetWorkflowPhaseCode: 'ASSISTANCE',
            });
          }
          throw new Error('การดำเนินการกับเคสไม่ถูกต้อง');
        }),
        assertResolutionOutcome: jest.fn((code: string | null) => Promise.resolve(code)),
        getAssistanceMeasures: jest.fn((codes: string[]) =>
          Promise.resolve(
            codes.map((code) => ({
              code,
              label: code === 'SCHOLARSHIP' ? 'ให้ทุนการศึกษา' : code,
              requiresDetail: false,
            })),
          ),
        ),
      } as unknown as CaseTrackingOptionsService,
    );
  });

  it('opens one scoped case from the authoritative student record', async () => {
    const studentId = '11111111-1111-4111-8111-111111111111';
    const actor = buildActor(['dashboard']);

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
    expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalled();
  });

  it('returns the existing active case instead of creating a duplicate', async () => {
    taskRepository.findActiveCaseByStudentUuid.mockResolvedValueOnce({ id: 10 });

    const result = await service.openCase(
      {
        student_id: '11111111-1111-4111-8111-111111111111',
        reason: 'ติดตามต่อ',
      },
      buildActor(['dashboard']),
    );

    expect(result.created).toBe(false);
    expect(taskRepository.createCase).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseStatusChanged).not.toHaveBeenCalled();
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

    const result = await service.getCase(10, buildActor(['dashboard']));

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

  it('serializes database attachment arrays for the case detail client', async () => {
    taskRepository.listTasksByCase.mockResolvedValueOnce([
      {
        task_id: 'task-id',
        task_status: 'COMPLETED',
        photo_paths: ['/uploads/visit-attachments/proof.png'],
      },
    ]);

    const result = await service.getCase(10, buildActor(['dashboard']));

    expect(result.data.follow_up_rounds[0].photo_paths).toBe(
      '["/uploads/visit-attachments/proof.png"]',
    );
  });

  it('returns teacher comments only to observation managers', async () => {
    taskRepository.findCaseDetailById.mockResolvedValue({
      id: 10,
      student_name: 'เด็ก ทดสอบ',
      teacher_comment: 'ข้อมูลข้อสังเกตที่จำกัดสิทธิ์',
      status: 'OPEN',
      school_id: 10010002,
    });

    const restricted = await service.getCase(10, buildActor(['dashboard']));
    const allowed = await service.getCase(10, buildActor(['dashboard', 'students']));

    expect(restricted.data.teacher_comment).toBeNull();
    expect(allowed.data.teacher_comment).toBe('ข้อมูลข้อสังเกตที่จำกัดสิทธิ์');
  });

  it('hides an out-of-scope student when opening a case', async () => {
    taskRepository.findStudentForCaseCreation.mockResolvedValueOnce(null);

    await expect(
      service.openCase(
        {
          student_id: '11111111-1111-4111-8111-111111111111',
          reason: 'ติดตามต่อ',
        },
        buildActor(['dashboard']),
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

  it('allows REFER_AGENCY with review-cases permission and ignores client reviewed_by', async () => {
    const result = await service.reviewCase(
      10,
      {
        review_action: 'REFER_AGENCY',
        review_note: 'ส่งต่อหน่วยงาน',
        referral_agency_id: 12,
        reviewed_by: 'client-forged-reviewer',
      },
      buildActor(['dashboard']),
    );

    expect(result.case_status).toBe('RESOLVED');
    expect(result.completion_outcome_code).toBe('REFERRED_AGENCY');
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'REFER_AGENCY',
        reviewNote: 'ส่งต่อหน่วยงาน',
        reviewedBy: 'ผอ. ทดสอบ',
        sourceActorUserId: 1,
      }),
      undefined,
    );
    expect(taskRepository.insertCaseReferral).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 10, agencyId: 12, referredByUserId: 1 }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_REFER_AGENCY',
        targetType: 'case',
        targetId: '10',
      }),
    );
  });

  it('returns a successful review after notification failure post-commit', async () => {
    notificationsService.notifyCaseStatusChanged.mockRejectedValueOnce(
      new Error('notification service unavailable'),
    );

    await expect(
      service.reviewCase(
        10,
        {
          review_action: 'REFER_AGENCY',
          review_note: 'ส่งต่อเพื่อดูแลต่อ',
          referral_agency_id: 12,
        },
        buildActor(['dashboard']),
      ),
    ).resolves.toEqual(expect.objectContaining({ success: true, case_status: 'RESOLVED' }));
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalled();
    expect(taskRepository.insertCaseReview).toHaveBeenCalled();
  });

  it('requires a reason before recording a human review', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'REFER_AGENCY', review_note: '' },
        buildActor(['dashboard']),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
  });

  it('allows CLOSE and stores the CLOSED completion outcome', async () => {
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
      },
      buildActor(['dashboard', 'dashboard']),
    );

    expect(result.case_status).toBe('RESOLVED');
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalledWith(
      10,
      'RESOLVED',
      'CLOSED',
      undefined,
      expect.objectContaining({ id: 1 }),
      null,
    );
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'CLOSE',
        resolutionOutcome: null,
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
      completionOutcome: 'CLOSED',
      resolutionOutcome: null,
      targetWorkflowPhase: null,
      referralAgencyId: null,
      proposedAssistanceMeasureCodes: [],
    });
  });

  it('sends a follow-up case into the assistance phase on ASSIST', async () => {
    const result = await service.reviewCase(
      10,
      {
        review_action: 'ASSIST',
        review_note: 'ควรให้ทุนการศึกษา',
        assistance_measure_codes: ['SCHOLARSHIP'],
      },
      buildActor(['dashboard']),
    );

    expect(result.case_status).toBe('OPEN');
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalledWith(
      10,
      'OPEN',
      null,
      undefined,
      expect.objectContaining({ id: 1 }),
      'ASSISTANCE',
    );
    expect(taskRepository.insertCaseReviewAssistanceMeasures).toHaveBeenCalledWith(
      expect.any(String),
      ['SCHOLARSHIP'],
      undefined,
    );
  });

  it('allows ASSIST again on a case already in the assistance phase', async () => {
    taskRepository.findCaseById.mockResolvedValueOnce({
      id: 10,
      student_name: 'นักเรียน ทดสอบ',
      school_id: 10010002,
      workflow_phase_code: 'ASSISTANCE',
    });

    await expect(
      service.reviewCase(
        10,
        {
          review_action: 'ASSIST',
          review_note: 'ช่วยเหลือรอบสอง',
          assistance_measure_codes: ['SCHOLARSHIP'],
        },
        buildActor(['dashboard']),
      ),
    ).resolves.toMatchObject({ case_status: 'OPEN' });
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalledWith(
      10,
      'OPEN',
      null,
      undefined,
      expect.objectContaining({ id: 1 }),
      'ASSISTANCE',
    );
  });

  // Reviewing, closing and referring used to be three separate permissions;
  // they are all work done on รายงานสถานะนักเรียน, so that page's permission is
  // what decides — and an actor without it still gets nothing.
  it('rejects a review action from an actor without the report page', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'CLOSE', review_note: 'ไม่มีสิทธิ์ปิดเคส' },
        buildActor(['students']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('denies case mutation to an EXECUTIVE even when raw permissions are re-granted', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'REFER_AGENCY', review_note: 'ไม่ควรทำได้' },
        buildActor(['dashboard'], { roles: ['EXECUTIVE'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
  });

  it('rejects the retired FORWARD action before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'FORWARD', review_note: 'legacy request' },
        buildActor(['dashboard']),
      ),
    ).rejects.toThrow('การดำเนินการกับเคสไม่ถูกต้อง');

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });
});
