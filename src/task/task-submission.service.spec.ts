import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { AttendanceWriteService } from '../attendance/attendance-write.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { getBangkokDateString } from '../common/utils/date.util';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import { TaskSubmissionService } from './task-submission.service';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import type { NotificationsService } from '../notifications/notifications.service';

const STUDENT_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
];

function getBangkokIsoDayOfWeek(): number {
  const [year, month, day] = getBangkokDateString().split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

describe('TaskSubmissionService', () => {
  let service: TaskSubmissionService;
  let taskAccessService: jest.Mocked<Pick<TaskAccessService, 'getTaskByToken'>>;
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'findTaskSubmissionContextByTokenHash'
      | 'listTaskStudents'
      | 'withTransaction'
      | 'lockLiveTaskLink'
      | 'listLinkedTimetableSlots'
      | 'getSystemSettingValue'
      | 'insertTaskSubmission'
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
      | 'getHomeVisitAssessment'
    >
  >;

  beforeEach(() => {
    taskAccessService = {
      getTaskByToken: jest.fn(),
    };
    taskRepository = {
      findTaskSubmissionContextByTokenHash: jest.fn(),
      listTaskStudents: jest.fn(),
      withTransaction: jest.fn(async (callback) => await callback(undefined)),
      lockLiveTaskLink: jest.fn().mockResolvedValue({ id: 'link-1' }),
      listLinkedTimetableSlots: jest.fn().mockResolvedValue([]),
      getSystemSettingValue: jest.fn().mockResolvedValue('SCHEDULED'),
      insertTaskSubmission: jest.fn().mockResolvedValue(undefined),
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
      notifyTaskSubmitted: jest.fn().mockResolvedValue(undefined),
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
      getHomeVisitAssessment: jest.fn().mockResolvedValue({
        code: 'NO_CONCERN',
        label: 'ไม่พบปัญหาเพิ่มเติม',
      }),
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

  it('passes the magic session token to attendance link validation', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'ATTENDANCE',
      auth_required: true,
    });

    await expect(
      service.saveTaskAttendance('public-token', [], 'verified-session-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskAccessService.getTaskByToken).toHaveBeenCalledWith(
      'public-token',
      'verified-session-token',
    );
  });

  it('saves subject attendance only for a selected linked timetable slot', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'ATTENDANCE',
      auth_required: false,
      link_id: 'link-1',
      assigned_to_name: 'ครูประจำวิชา',
      target_school_id: 10010002,
      target_grade: 'ม.6',
      target_room: '1',
    });
    taskRepository.listTaskStudents.mockResolvedValue(
      STUDENT_IDS.map((studentId) => ({ id: studentId })),
    );
    taskRepository.listLinkedTimetableSlots.mockResolvedValue([
      {
        id: 11,
        school_id: 10010002,
        grade_level_id: 423,
        grade_label: 'ม.6',
        room_no: 1,
        subject_id: 5,
        day_of_week: getBangkokIsoDayOfWeek(),
        period: 3,
      },
    ]);

    await service.saveTaskAttendance('public-token', {
      timetable_slot_id: 11,
      records: STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
    });

    expect(attendanceWriteService.saveAttendanceGroupsWithinTransaction).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        actorUserId: null,
        actorLabel: 'task-link:link-1',
        recorder: 'ครูประจำวิชา',
        session: {
          kind: 'SUBJECT',
          period: 3,
          subjectId: 5,
          timetableSlotId: 11,
        },
      }),
      undefined,
    );
  });

  it('requires a timetable slot when the attendance link has linked slots', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'ATTENDANCE',
      auth_required: false,
      link_id: 'link-1',
      target_school_id: 10010002,
      target_grade: 'ม.6',
      target_room: '1',
    });
    taskRepository.listTaskStudents.mockResolvedValue(
      STUDENT_IDS.map((studentId) => ({ id: studentId })),
    );
    taskRepository.listLinkedTimetableSlots.mockResolvedValue([
      {
        id: 11,
        school_id: 10010002,
        grade_level_id: 423,
        grade_label: 'ม.6',
        room_no: 1,
        subject_id: 5,
        day_of_week: getBangkokIsoDayOfWeek(),
        period: 3,
      },
    ]);

    await expect(
      service.saveTaskAttendance('public-token', {
        records: STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attendanceWriteService.saveAttendanceGroupsWithinTransaction).not.toHaveBeenCalled();
  });

  it('requires a review assessment for a home-visit report', async () => {
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
    trackingOptions.getHomeVisitAssessment.mockResolvedValueOnce(null);

    await expect(
      service.saveTaskSubmission('public-token', {
        notes: 'ลงพื้นที่แล้ว',
        case_follow_up_decision: 'REQUEST_REVIEW',
      }),
    ).rejects.toThrow('กรุณาเลือกผลประเมินหลังลงพื้นที่');
    expect(taskRepository.insertTaskSubmission).not.toHaveBeenCalled();
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

    await service.saveTaskSubmission('public-token', {
      cause_category: 'ATTENDANCE',
      notes: 'พบผู้ปกครองแล้ว',
      case_follow_up_decision: 'REQUEST_REVIEW',
    });

    expect(taskRepository.insertTaskSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        caseFollowUpDecision: 'REQUEST_REVIEW',
        caseResolutionOutcomeCode: null,
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

    await service.saveTaskSubmission('public-token', {
      notes: 'พบผู้ปกครองและบันทึกข้อมูลแล้ว',
      visited_at: '2026-07-31T02:30:00.000Z',
    });

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

  it('does not notify the same person twice for one submission', async () => {
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

    await service.saveTaskSubmission('public-token', {
      notes: 'พบผู้ปกครองแล้ว',
      case_follow_up_decision: 'REQUEST_REVIEW',
    });

    expect(notificationsService.notifyTaskSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyNotifiedUserIds: [7, 9] }),
    );
  });

  it('returns success when post-commit notifications fail', async () => {
    notificationsService.notifyCaseStatusChanged.mockRejectedValueOnce(
      new Error('notification database unavailable'),
    );
    notificationsService.notifyTaskSubmitted.mockRejectedValueOnce(
      new Error('notification queue unavailable'),
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
      service.saveTaskSubmission('public-token', {
        notes: 'บันทึกผลการเยี่ยมบ้านแล้ว',
        case_follow_up_decision: 'REQUEST_REVIEW',
      }),
    ).resolves.toEqual({ success: true });
    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalled();
    expect(taskRepository.updateTaskStatus).toHaveBeenCalledWith('task-1', 'COMPLETED', undefined);
    expect(notificationsService.notifyTaskSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyNotifiedUserIds: [] }),
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
      service.saveTaskSubmission('public-token', {
        notes: 'ลงพื้นที่แล้ว',
        visited_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toThrow('วันและเวลาที่ลงพื้นที่ต้องไม่อยู่ในอนาคต');

    await expect(
      service.saveTaskSubmission('public-token', {
        notes: 'ลงพื้นที่แล้ว',
        visited_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toThrow('วันและเวลาที่ลงพื้นที่ต้องไม่อยู่ก่อนเวลาที่ได้รับมอบหมาย');

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

    await service.saveTaskSubmission('public-token', {
      notes: 'ยืนยันที่อยู่ใหม่จากผู้ปกครอง',
      home_visit_exception_code: 'ADDRESS_CHANGED',
      updated_address_line: '99/9 หมู่ 5',
      updated_address_province: 'กรุงเทพมหานคร',
      updated_address_district: 'ดอนเมือง',
      updated_address_sub_district: 'สีกัน',
      updated_postal_code: '10210',
    });

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

  it('requires an explanation when the student was not found', async () => {
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
      service.saveTaskSubmission('public-token', {
        home_visit_exception_code: 'STUDENT_NOT_FOUND',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(taskRepository.insertTaskSubmission).not.toHaveBeenCalled();
  });

  it('moves the case directly to STUDENT_NOT_FOUND and completes the task link', async () => {
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

    await service.saveTaskSubmission('public-token', {
      home_visit_exception_code: 'STUDENT_NOT_FOUND',
      notes: 'สอบถามเพื่อนบ้านแล้วไม่พบตัวนักเรียน',
    });

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
  });

  it('allows the home visitor to close a simple case with an outcome', async () => {
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

    await service.saveTaskSubmission('public-token', {
      notes: 'กลับมาเรียนแล้ว',
      case_follow_up_decision: 'CLOSE_CASE',
      case_resolution_outcome_code: 'RETURNED_TO_SCHOOL',
    });

    expect(taskRepository.updateCaseAfterSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 10, nextStatus: 'RESOLVED' }),
      undefined,
    );
    expect(taskRepository.insertCaseReview).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 10,
        reviewAction: 'CLOSE',
        resolutionOutcome: 'RETURNED_TO_SCHOOL',
        reviewedBy: 'ครูลงพื้นที่',
      }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_CLOSE', targetId: '10' }),
    );
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
      service.saveTaskSubmission('public-token', {
        notes: 'รายงานจากลิงก์เก่า',
        case_follow_up_decision: 'REQUEST_REVIEW',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(taskRepository.insertCaseReview).not.toHaveBeenCalled();
    expect(taskRepository.updateTaskStatus).not.toHaveBeenCalled();
    expect(notificationsService.notifyCaseStatusChanged).not.toHaveBeenCalled();
  });
});
