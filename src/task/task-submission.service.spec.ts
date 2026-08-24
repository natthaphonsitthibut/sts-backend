import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { AttendanceWriteService } from '../attendance/attendance-write.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import { TaskSubmissionService } from './task-submission.service';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SaveTaskSubmissionDto } from './dto/task.dto';

const STUDENT_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
];

describe('TaskSubmissionService', () => {
  let service: TaskSubmissionService;
  let taskAccessService: jest.Mocked<Pick<TaskAccessService, 'getTaskByToken'>>;
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'findTaskSubmissionContextByTokenHash'
      | 'withTransaction'
      | 'lockLiveTaskLink'
      | 'getSystemSettingValue'
      | 'insertTaskSubmission'
      | 'insertHomeVisitCareObservations'
      | 'updateCaseAfterSubmission'
      | 'insertCaseReview'
      | 'updateTaskStatus'
      | 'updateTaskLinkStatus'
    >
  >;
  let attendanceWriteService: jest.Mocked<
    Pick<AttendanceWriteService, 'saveAttendanceGroupsWithinTransaction'>
  >;
  let notificationsService: { [k: string]: jest.Mock };
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let trackingOptions: jest.Mocked<
    Pick<
      CaseTrackingOptionsService,
      | 'getFollowUpDecision'
      | 'assertResolutionOutcome'
      | 'getHomeVisitException'
      | 'getFollowUpProblemCategory'
      | 'getParentalStatus'
      | 'getGuardianType'
      | 'getResidenceEnvironments'
      | 'getTaskExecutionOutcome'
      | 'getNonFollowUpReason'
      | 'getCareObservationCodes'
    >
  >;

  const validVisitData = (
    overrides: Partial<SaveTaskSubmissionDto> = {},
  ): SaveTaskSubmissionDto => ({
    visited_at: '2026-07-31T02:30:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    taskAccessService = {
      getTaskByToken: jest.fn(),
    };
    taskRepository = {
      findTaskSubmissionContextByTokenHash: jest.fn(),
      withTransaction: jest.fn(async (callback) => await callback(undefined)),
      lockLiveTaskLink: jest.fn().mockResolvedValue({ id: 'link-1' }),
      getSystemSettingValue: jest.fn().mockResolvedValue('SCHEDULED'),
      insertTaskSubmission: jest.fn().mockResolvedValue(71),
      insertHomeVisitCareObservations: jest.fn().mockResolvedValue(undefined),
      updateCaseAfterSubmission: jest.fn().mockResolvedValue(true),
      insertCaseReview: jest.fn().mockResolvedValue(undefined),
      updateTaskStatus: jest.fn().mockResolvedValue(undefined),
      updateTaskLinkStatus: jest.fn().mockResolvedValue(undefined),
    };
    attendanceWriteService = {
      saveAttendanceGroupsWithinTransaction: jest
        .fn()
        .mockResolvedValue([{ calendarConfigured: false, affectedStudentIds: STUDENT_IDS }]),
    };
    notificationsService = {
      notifyCaseStatusChanged: jest.fn().mockResolvedValue([]),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    trackingOptions = {
      getFollowUpDecision: jest.fn((code: string) =>
        Promise.resolve({
          code,
          label: code === 'CLOSE_CASE' ? 'ปิดเคส' : 'ส่งให้ตรวจผล',
          targetStatus: code === 'CLOSE_CASE' ? 'RESOLVED' : 'PENDING_REVIEW',
          requiresResolutionOutcome: code === 'CLOSE_CASE',
          completionOutcomeCode: null,
        }),
      ),
      assertResolutionOutcome: jest.fn((code: string | null) => Promise.resolve(code)),
      getHomeVisitException: jest.fn().mockResolvedValue(null),
      getFollowUpProblemCategory: jest.fn().mockResolvedValue({
        code: 'HEALTH',
        label: 'ปัญหาด้านสุขภาพ',
        guidance: 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ',
      }),
      // Optional household answers resolve to valid catalog values by default;
      // individual tests override them with null when exercising blank input.
      getParentalStatus: jest
        .fn()
        .mockResolvedValue({ code: 'LIVE_TOGETHER', label: 'อยู่ด้วยกัน' }),
      getGuardianType: jest
        .fn()
        .mockResolvedValue({ code: 'FATHER', label: 'บิดา', requiresDetail: false }),
      getResidenceEnvironments: jest
        .fn()
        .mockResolvedValue([
          { code: 'NORMAL', label: 'ปกติ', requiresDetail: false, isExclusive: true },
        ]),
      getTaskExecutionOutcome: jest.fn((code: string | null) =>
        code
          ? Promise.resolve(code)
          : Promise.reject(new BadRequestException('กรุณาเลือกผลการดำเนินงานครั้งนี้')),
      ),
      getNonFollowUpReason: jest.fn((code: string | null) => Promise.resolve(code)),
      getCareObservationCodes: jest.fn((_kind, codes: string[]) => Promise.resolve(codes)),
    };

    service = new TaskSubmissionService(
      taskRepository as unknown as TaskRepository,
      taskAccessService as unknown as TaskAccessService,
      {} as AutomationService,
      attendanceWriteService as unknown as AttendanceWriteService,
      notificationsService as unknown as NotificationsService,
      auditLog as unknown as AuditLogService,
      trackingOptions as unknown as CaseTrackingOptionsService,
    );
  });

  it('rejects visit submission when OTP authentication is still required', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: true,
    });

    await expect(
      service.saveTaskSubmission('public-token', { notes: 'ตรวจเยี่ยม' }, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskRepository.findTaskSubmissionContextByTokenHash).not.toHaveBeenCalled();
  });

  it('derives a successful execution outcome for a visit that found the student', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
    });
    trackingOptions.getParentalStatus.mockResolvedValueOnce(null);
    trackingOptions.getGuardianType.mockResolvedValueOnce(null);
    trackingOptions.getResidenceEnvironments.mockResolvedValueOnce([]);
    trackingOptions.getFollowUpProblemCategory.mockResolvedValueOnce(null);

    await expect(service.saveTaskSubmission('public-token', validVisitData())).resolves.toEqual({
      success: true,
    });
    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        taskExecutionOutcomeCode: 'SUCCEEDED',
        caseFollowUpDecision: 'REQUEST_REVIEW',
      }),
      undefined,
    );
  });

  it('requires an explicit execution outcome for assistance work', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'ASSIST',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'ASSIST',
      case_id: 10,
    });

    await expect(
      service.saveTaskSubmission('public-token', {
        assisted_at: '2026-07-31T02:30:00.000Z',
      }),
    ).rejects.toThrow('กรุณาเลือกผลการดำเนินงานครั้งนี้');

    await expect(
      service.saveTaskSubmission('public-token', {
        assisted_at: '2026-07-31T02:30:00.000Z',
        task_execution_outcome_code: 'SUCCEEDED',
      }),
    ).resolves.toEqual({ success: true });
    expect(taskRepository.insertTaskSubmission).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskExecutionOutcomeCode: 'SUCCEEDED' }),
      undefined,
    );
  });

  it('drops the household answers when the student was not found', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
    });
    trackingOptions.getHomeVisitException.mockResolvedValueOnce({
      code: 'STUDENT_NOT_FOUND',
      label: 'ไม่พบนักเรียน',
      requiresUpdatedAddress: false,
    });
    trackingOptions.getParentalStatus.mockResolvedValueOnce(null);
    trackingOptions.getGuardianType.mockResolvedValueOnce(null);
    trackingOptions.getResidenceEnvironments.mockResolvedValueOnce([]);

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        task_execution_outcome_code: 'NOT_SUCCEEDED',
        notes: 'ตรวจสอบรอบบ้านและสอบถามเพื่อนบ้านแล้วไม่พบนักเรียน',
        home_visit_exception_code: 'STUDENT_NOT_FOUND',
      }),
    );

    expect(taskRepository.insertTaskSubmission).toHaveBeenCalled();
  });

  it('keeps the visit problem assessment optional', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
    });
    trackingOptions.getFollowUpProblemCategory.mockResolvedValueOnce(null);

    await expect(service.saveTaskSubmission('public-token', validVisitData())).resolves.toEqual({
      success: true,
    });
    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ followUpProblemCategoryCode: null }),
      undefined,
    );
  });

  it('sends a home-visit report for review without closing the case', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        follow_up_problem_category_code: 'ACADEMIC',
        notes: 'พบผู้ปกครองแล้ว',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
        case_follow_up_decision: 'REQUEST_REVIEW',
      }),
    );

    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        caseFollowUpDecision: 'REQUEST_REVIEW',
        caseResolutionOutcomeCode: null,
        followUpProblemCategoryCode: 'HEALTH',
      }),
      undefined,
    );
    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 10, nextStatus: 'PENDING_REVIEW' }),
      undefined,
    );
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('defaults a case-linked BA form submission to review', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        notes: 'พบผู้ปกครองและบันทึกข้อมูลแล้ว',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
        visited_at: '2026-07-31T02:30:00.000Z',
      }),
    );

    expect(trackingOptions.getFollowUpDecision).toHaveBeenCalledWith('REQUEST_REVIEW');
    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        visitedAt: '2026-07-31T02:30:00.000Z',
        caseFollowUpDecision: 'REQUEST_REVIEW',
      }),
      undefined,
    );
    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: 'PENDING_REVIEW' }),
      undefined,
    );
  });

  it('notifies the resulting case status after one submission', async () => {
    notificationsService.notifyCaseStatusChanged.mockResolvedValue([7, 9]);
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
      assigned_to_name: 'ครูลงพื้นที่',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        notes: 'พบผู้ปกครองแล้ว',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
        case_follow_up_decision: 'REQUEST_REVIEW',
      }),
    );

    expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        nextStatus: 'PENDING_REVIEW',
      }),
    );
  });

  it('returns success when post-commit notifications fail', async () => {
    notificationsService.notifyCaseStatusChanged.mockRejectedValueOnce(
      new Error('notification database unavailable'),
    );
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
      assigned_to_name: 'ครูลงพื้นที่',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await expect(
      service.saveTaskSubmission(
        'public-token',
        validVisitData({
          notes: 'บันทึกผลการเยี่ยมบ้านแล้ว',
          residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
          case_follow_up_decision: 'REQUEST_REVIEW',
        }),
      ),
    ).resolves.toEqual({ success: true });
    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalled();
    expect(taskRepository.updateTaskStatus).toHaveBeenCalledWith('task-1', 'COMPLETED', undefined);
    expect(notificationsService.notifyCaseStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        nextStatus: 'PENDING_REVIEW',
      }),
    );
  });

  it('rejects a visit timestamp outside the assignment window', async () => {
    const openedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
      opens_at: openedAt,
      created_at: openedAt,
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await expect(
      service.saveTaskSubmission(
        'public-token',
        validVisitData({
          notes: 'ลงพื้นที่แล้ว',
          residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
          visited_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow('วันและเวลาที่ไปเยี่ยม/ติดตามต้องไม่อยู่ในอนาคต');

    await expect(
      service.saveTaskSubmission(
        'public-token',
        validVisitData({
          notes: 'ลงพื้นที่แล้ว',
          residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
          visited_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow('วันและเวลาที่ไปเยี่ยม/ติดตามต้องไม่อยู่ก่อนเวลาที่ได้รับมอบหมาย');

    expect(taskRepository.insertTaskSubmission).not.toHaveBeenCalled();
  });

  it('persists a structured changed address and updates the case address fields', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });
    trackingOptions.getHomeVisitException.mockResolvedValue({
      code: 'ADDRESS_CHANGED',
      label: 'เปลี่ยนที่อยู่',
      requiresUpdatedAddress: true,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        notes: 'ยืนยันที่อยู่ใหม่จากผู้ปกครอง',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
        home_visit_exception_code: 'ADDRESS_CHANGED',
        updated_address_line: '99/9 หมู่ 5',
        updated_address_province: 'กรุงเทพมหานคร',
        updated_address_district: 'ดอนเมือง',
        updated_address_sub_district: 'สีกัน',
        updated_postal_code: '10210',
      }),
    );

    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        addressChanged: true,
        homeVisitExceptionCode: 'ADDRESS_CHANGED',
        updatedStudentAddress: '99/9 หมู่ 5 ต.สีกัน อ.ดอนเมือง จ.กรุงเทพมหานคร 10210',
        updatedAddressLine: '99/9 หมู่ 5',
      }),
      undefined,
    );
    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAddressLine: '99/9 หมู่ 5',
        updatedAddressProvince: 'กรุงเทพมหานคร',
        updatedPostalCode: '10210',
      }),
      undefined,
    );
  });

  it('keeps an explanation optional when the student was not found', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
    });
    trackingOptions.getHomeVisitException.mockResolvedValue({
      code: 'STUDENT_NOT_FOUND',
      label: 'ไม่พบนักเรียน',
      requiresUpdatedAddress: false,
    });

    await expect(
      service.saveTaskSubmission(
        'public-token',
        validVisitData({
          home_visit_exception_code: 'STUDENT_NOT_FOUND',
        }),
      ),
    ).resolves.toEqual({ success: true });

    expect(taskRepository.insertTaskSubmission).toHaveBeenCalled();
  });

  it('keeps a not-found visit in the re-assignment lane', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });
    trackingOptions.getHomeVisitException.mockResolvedValue({
      code: 'STUDENT_NOT_FOUND',
      label: 'ไม่พบนักเรียน',
      requiresUpdatedAddress: false,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        home_visit_exception_code: 'STUDENT_NOT_FOUND',
        notes: 'สอบถามเพื่อนบ้านแล้วไม่พบตัวนักเรียน',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
      }),
    );

    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        nextStatus: 'STUDENT_NOT_FOUND',
        completionOutcomeCode: null,
      }),
      undefined,
    );
    expect(taskRepository.updateTaskStatus).toHaveBeenCalledWith('task-1', 'COMPLETED', undefined);
    expect(taskRepository.updateTaskLinkStatus).toHaveBeenCalledWith(
      'link-1',
      'COMPLETED',
      undefined,
    );
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        caseFollowUpDecision: null,
        taskExecutionOutcomeCode: 'NOT_SUCCEEDED',
      }),
      undefined,
    );
  });

  it('ignores legacy case actions from a link holder and always requests review', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });

    await service.saveTaskSubmission(
      'public-token',
      validVisitData({
        notes: 'กลับมาเรียนแล้ว',
        residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
        case_follow_up_decision: 'CLOSE_CASE',
        case_resolution_outcome_code: 'RETURNED_TO_SCHOOL',
      }),
    );

    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 10, nextStatus: 'PENDING_REVIEW' }),
      undefined,
    );
    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects a stale visit report after the case has already transitioned', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: false,
      link_id: 'link-1',
    });
    taskRepository.findTaskSubmissionContextByTokenHash.mockResolvedValue({
      link_id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      case_id: 10,
      assigned_to_name: 'ครูลงพื้นที่',
      student_name: 'เด็ก ทดสอบ',
      school_id: 10010002,
    });
    taskRepository.updateCaseAfterSubmission.mockResolvedValueOnce(false);

    await expect(
      service.saveTaskSubmission(
        'public-token',
        validVisitData({
          notes: 'รายงานจากลิงก์เก่า',
          residence_environment_detail: 'บ้านอยู่ริมถนนใหญ่ รถวิ่งเร็ว',
          case_follow_up_decision: 'REQUEST_REVIEW',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
    expect(taskRepository.updateTaskStatus).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseStatusChanged).not.toHaveBeenCalled();
  });
});
