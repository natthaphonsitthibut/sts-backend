import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
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

const REFERRAL_ID = '22222222-2222-4222-8222-222222222222';

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
      | 'listStudentFollowUpHistory'
      | 'listActiveReferralAgencies'
      | 'lockCaseReferralForResult'
      | 'recordCaseReferralResult'
      | 'lockReferralLinkForReport'
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
        // Reviewing is only reachable once a report has been submitted.
        status: 'PENDING_REVIEW',
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
      listStudentFollowUpHistory: jest.fn().mockResolvedValue([]),
      listActiveReferralAgencies: jest.fn().mockResolvedValue([]),
      lockCaseReferralForResult: jest.fn().mockResolvedValue({
        id: REFERRAL_ID,
        status_code: 'REFERRED',
        case_status: 'AWAITING_REFERRAL_OUTCOME',
        school_id: 10010002,
        student_uuid: '11111111-1111-4111-8111-111111111111',
        student_name: 'เด็ก ทดสอบ',
        has_result: false,
        is_latest: true,
      }),
      recordCaseReferralResult: jest.fn().mockResolvedValue(true),
      lockReferralLinkForReport: jest.fn().mockResolvedValue({
        status_code: 'ACTIVE',
        has_started: true,
        has_not_expired: true,
      }),
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
              targetStatus: 'AWAITING_REFERRAL',
              requiresResolutionOutcome: false,
              completionOutcomeCode: null,
              requiredPermission: 'case:review',
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
              requiredPermission: 'case:review',
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
              requiredPermission: 'case:review',
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
    const actor = buildActor(['dashboard', 'case:assign', 'case:review']);

    const result = await service.openCase(
      { student_id: studentId, reason: '  ต้องติดตามเรื่องการมาเรียน  ' },
      actor,
    );

    expect(result.created).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ id: 10, status: 'OPEN' }));
    // The lookup is handed the scope it must apply, not the whole account —
    // the same shape a classroom link can supply without an account at all.
    expect(taskRepository.findStudentForCaseCreation).toHaveBeenCalledWith(
      studentId,
      { id: actor.id, data_scope: actor.data_scope },
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

  // A teacher reached through a classroom link has no account, so the case
  // records their `teachers` row and is checked against the link's school.
  it('opens a case for a link teacher without an account', async () => {
    const studentId = '11111111-1111-4111-8111-111111111111';

    const result = await service.openCaseFromLink(
      { student_id: studentId, reason: 'ขาดเรียนติดต่อกัน' },
      { schoolId: 10010002, teacherId: '77', displayName: 'ครู ทดสอบ' },
    );

    expect(result.created).toBe(true);
    expect(taskRepository.findStudentForCaseCreation).toHaveBeenCalledWith(
      studentId,
      { data_scope: { school_ids: [10010002] } },
      undefined,
    );
    expect(taskRepository.createCase).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUuid: studentId,
        createdBy: null,
        createdByTeacherId: '77',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_CREATE',
        actorUserId: null,
        actorLabel: 'ครู ทดสอบ',
      }),
    );
  });

  it('returns the existing active case instead of creating a duplicate', async () => {
    taskRepository.findActiveCaseByStudentUuid.mockResolvedValueOnce({ id: 10 });

    const result = await service.openCase(
      {
        student_id: '11111111-1111-4111-8111-111111111111',
        reason: 'ติดตามต่อ',
      },
      buildActor(['dashboard', 'case:assign', 'case:review']),
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

  it('keeps a fractional home pin instead of dropping it', async () => {
    taskRepository.findCaseDetailById.mockResolvedValueOnce({
      id: 10,
      student_id: '11111111-1111-4111-8111-111111111111',
      student_name: 'เด็ก ทดสอบ',
      student_lat: '13.286149',
      student_lng: '100.9207',
      status: 'OPEN',
      school_id: 10010002,
    });

    const result = await service.getCase(10, buildActor(['dashboard']));

    expect(result.data).toMatchObject({
      student_lat: 13.286149,
      student_lng: 100.9207,
      is_approximate_home_location: false,
    });
  });

  it("gives a case without a pin the profile's approximate pin", async () => {
    const geocodeCache = { resolve: jest.fn().mockResolvedValue({ lat: 13.28, lng: 100.92 }) };
    const withGeocode = new CaseService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService({} as TaskRepository),
      auditLog as unknown as AuditLogService,
      notificationsService as unknown as NotificationsService,
      {} as CaseTrackingOptionsService,
      undefined,
      geocodeCache as never,
    );
    taskRepository.findCaseDetailById.mockResolvedValueOnce({
      id: 10,
      student_id: '11111111-1111-4111-8111-111111111111',
      student_name: 'เด็ก ทดสอบ',
      student_lat: null,
      student_lng: null,
      address_house_no: '126/18',
      VillageNumber_Onec: '10',
      SubDistrictNameThai_Onec: 'แสนสุข',
      DistrictNameThai_Onec: 'เมืองชลบุรี',
      ProvinceNameThai_Onec: 'ชลบุรี',
      PostalCode_Onec: '20130',
      status: 'OPEN',
      school_id: 10010002,
    });

    const result = await withGeocode.getCase(10, buildActor(['dashboard']));

    expect(geocodeCache.resolve).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '126/18 หมู่ 10 แสนสุข เมืองชลบุรี ชลบุรี 20130',
    );
    expect(result.data).toMatchObject({
      student_lat: 13.28,
      student_lng: 100.92,
      is_approximate_home_location: true,
      home_province: 'ชลบุรี',
      home_postal_code: '20130',
    });
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
        buildActor(['dashboard', 'case:assign', 'case:review']),
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
        reviewed_by: 'client-forged-reviewer',
      },
      buildActor(['dashboard', 'case:assign', 'case:review']),
    );

    // Deciding to refer parks the case in รอส่งต่อ, like ติดตามต่อ parks it
    // in รอมอบหมาย; the referral itself is sent from the case page.
    expect(result.case_status).toBe('AWAITING_REFERRAL');
    expect(result.completion_outcome_code).toBeNull();
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
    expect(taskRepository.insertCaseReferral).not.toHaveBeenCalled();
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
        },
        buildActor(['dashboard', 'case:assign', 'case:review']),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ success: true, case_status: 'AWAITING_REFERRAL' }),
    );
    expect(taskRepository.transitionPendingReviewCase).toHaveBeenCalled();
    expect(taskRepository.insertCaseReview).toHaveBeenCalled();
  });

  it('refuses an agency on the review: it is picked when the referral is sent', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'REFER_AGENCY', review_note: 'ส่งต่อ', referral_agency_id: 12 },
        buildActor(['dashboard', 'case:assign', 'case:review']),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
  });

  it('requires a reason before recording a human review', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'REFER_AGENCY', review_note: '' },
        buildActor(['dashboard', 'case:assign', 'case:review']),
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
      buildActor(['dashboard', 'case:review']),
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
      buildActor(['dashboard', 'case:assign', 'case:review']),
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
      status: 'PENDING_REVIEW',
    });

    await expect(
      service.reviewCase(
        10,
        {
          review_action: 'ASSIST',
          review_note: 'ช่วยเหลือรอบสอง',
          assistance_measure_codes: ['SCHOLARSHIP'],
        },
        buildActor(['dashboard', 'case:assign', 'case:review']),
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

  it('refuses to review a case that has no report waiting', async () => {
    taskRepository.findCaseById.mockResolvedValueOnce({
      id: 10,
      student_name: 'นักเรียน ทดสอบ',
      school_id: 10010002,
      // Nobody has submitted a follow-up report, so there is nothing to review.
      status: 'OPEN',
    });

    await expect(
      service.reviewCase(
        10,
        {
          review_action: 'CLOSE',
          review_note: 'ปิดเคส',
          resolution_outcome: 'RETURNED_TO_SCHOOL',
        },
        buildActor(['dashboard', 'case:assign', 'case:review']),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(taskRepository.transitionPendingReviewCase).not.toHaveBeenCalled();
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

  // รายงานสถานะนักเรียน reads cases; acting on one is `case:assign` / `case:review`,
  // which a ผู้ดูแลระบบ group does not carry by default (owner, 2026-09-28).
  it('keeps a dashboard-only account from reviewing, opening or withdrawing', async () => {
    const reader = buildActor(['dashboard'], { roles: ['S10010002_BASE_ADMIN'] });

    await expect(
      service.reviewCase(10, { review_action: 'CLOSE', review_note: 'อ่านอย่างเดียว' }, reader),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.openCase(
        { student_id: '11111111-1111-4111-8111-111111111111', reason: 'อ่านอย่างเดียว' },
        reader,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.cancelCaseAssignment(10, { cancel_reason: 'อ่านอย่างเดียว' }, reader),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects the retired FORWARD action before mutating', async () => {
    await expect(
      service.reviewCase(
        10,
        { review_action: 'FORWARD', review_note: 'legacy request' },
        buildActor(['dashboard', 'case:assign', 'case:review']),
      ),
    ).rejects.toThrow('การดำเนินการกับเคสไม่ถูกต้อง');

    expect(taskRepository.findCaseById).not.toHaveBeenCalled();
    expect(taskRepository.withTransaction).not.toHaveBeenCalled();
  });

  describe('applyReferralResult (the agency report through its link)', () => {
    const agencyReport = {
      linkId: '33333333-3333-4333-8333-333333333333',
      actionDate: '2026-10-08',
      identityProviderCode: 'ARAID',
      providerSubject: 'araid-subject',
      reporterName: 'นาง สมใจ หน่วยงาน',
    };
    const report = (resultCode: 'SUCCEEDED' | 'NOT_SUCCEEDED') =>
      service.applyReferralResult({
        caseId: 10,
        referralId: REFERRAL_ID,
        resultCode,
        note: 'นักเรียนกลับมาเรียนแล้ว',
        scopeActor: null,
        recordedByUserId: null,
        agencyReport,
        audit: { actorUserId: null, actorLabel: 'นาง สมใจ หน่วยงาน (หน่วยงาน)' },
      });

    it.each([
      ['locked during the request', { status_code: 'LOCKED' }, ForbiddenException],
      ['revoked during the request', { status_code: 'REVOKED' }, GoneException],
      ['expired during the request', { has_not_expired: false }, GoneException],
      ['not started', { has_started: false }, ForbiddenException],
      ['already used', { status_code: 'USED' }, ConflictException],
    ])(
      'rejects a reporting link that is %s under the transaction lock',
      async (_label, overrides, errorType) => {
        taskRepository.lockReferralLinkForReport.mockResolvedValueOnce({
          status_code: 'ACTIVE',
          has_started: true,
          has_not_expired: true,
          ...overrides,
        });
        await expect(report('SUCCEEDED')).rejects.toBeInstanceOf(errorType);
        expect(taskRepository.recordCaseReferralResult).not.toHaveBeenCalled();
        expect(auditLog.record).not.toHaveBeenCalled();
      },
    );

    it('rejects a link belonging to another referral', async () => {
      taskRepository.lockReferralLinkForReport.mockResolvedValueOnce(null);
      await expect(report('SUCCEEDED')).rejects.toBeInstanceOf(NotFoundException);
      expect(taskRepository.recordCaseReferralResult).not.toHaveBeenCalled();
    });

    it('hands the case back to review when the agency succeeded', async () => {
      await report('SUCCEEDED');

      expect(taskRepository.lockCaseReferralForResult).toHaveBeenCalledWith(
        10,
        REFERRAL_ID,
        null,
        undefined,
      );
      expect(taskRepository.recordCaseReferralResult).toHaveBeenCalledWith(
        {
          caseId: 10,
          referralId: REFERRAL_ID,
          referralStatusCode: 'COMPLETED',
          nextCaseStatus: 'PENDING_REVIEW',
          note: 'นักเรียนกลับมาเรียนแล้ว',
          recordedByUserId: null,
          agencyReport,
        },
        undefined,
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CASE_REFERRAL_RESULT',
          targetId: '10',
          metadata: {
            referralId: REFERRAL_ID,
            resultCode: 'SUCCEEDED',
            nextStatus: 'PENDING_REVIEW',
            reportedThroughLink: agencyReport.linkId,
          },
        }),
      );
    });

    it('hands the case back to review when the agency did not succeed', async () => {
      await report('NOT_SUCCEEDED');

      expect(taskRepository.recordCaseReferralResult).toHaveBeenCalledWith(
        expect.objectContaining({
          referralStatusCode: 'NOT_SUCCEEDED',
          nextCaseStatus: 'PENDING_REVIEW',
        }),
        undefined,
      );
      expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 10, nextStatus: 'PENDING_REVIEW' }),
      );
    });

    it('returns 404 for a referral that is not there', async () => {
      taskRepository.lockCaseReferralForResult.mockResolvedValueOnce(null);
      await expect(report('SUCCEEDED')).rejects.toBeInstanceOf(NotFoundException);
      expect(taskRepository.recordCaseReferralResult).not.toHaveBeenCalled();
    });

    it.each([
      ['already has a result', { has_result: true }],
      ['is not the latest referral', { is_latest: false }],
      ['belongs to a case no longer waiting', { case_status: 'RESOLVED' }],
    ])('refuses a referral that %s', async (_label, overrides) => {
      taskRepository.lockCaseReferralForResult.mockResolvedValueOnce({
        id: REFERRAL_ID,
        status_code: 'REFERRED',
        case_status: 'AWAITING_REFERRAL_OUTCOME',
        has_result: false,
        is_latest: true,
        ...overrides,
      });
      await expect(report('NOT_SUCCEEDED')).rejects.toBeInstanceOf(ConflictException);
      expect(taskRepository.recordCaseReferralResult).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
