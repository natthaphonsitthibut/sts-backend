import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,unit-test'),
}));

const tokenEncryption = new TokenEncryptionService({ taskLinkKey: Buffer.alloc(32, 7) });

function buildActor(): AuthenticatedRequestUser {
  return {
    id: 7,
    username: 'case-admin',
    roles: ['ADMIN'],
    permissions: ['create'],
    data_scope: { school_ids: [10010002] },
  };
}

describe('TaskLifecycleService', () => {
  const studentUuid = '11111111-1111-4111-8111-111111111111';
  const followUpRequestId = '22222222-2222-4222-8222-222222222222';
  let service: TaskLifecycleService;
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'withTransaction'
      | 'findSchoolById'
      | 'findStudentTermMetadata'
      | 'createCase'
      | 'updateCaseStatus'
      | 'createTask'
      | 'createTaskLink'
      | 'listTimetableSlotsForTaskLink'
      | 'insertTaskLinkTimetableSlots'
      | 'assignFollowerCampaignTarget'
      | 'lockFollowUpTaskAssignment'
      | 'markFollowUpTaskAssigned'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record' | 'recordAtomic'>>;

  beforeEach(() => {
    taskRepository = {
      withTransaction: jest.fn(async (callback) => {
        await callback(undefined);
      }),
      findSchoolById: jest.fn().mockResolvedValue({
        id: 10010002,
        province: 'กรุงเทพมหานคร',
        district: 'ดุสิต',
        sub_district: 'ดุสิต',
      }),
      findStudentTermMetadata: jest.fn().mockResolvedValue(null),
      createCase: jest.fn().mockResolvedValue(123),
      updateCaseStatus: jest.fn().mockResolvedValue(undefined),
      createTask: jest.fn().mockResolvedValue(undefined),
      createTaskLink: jest.fn().mockResolvedValue(undefined),
      listTimetableSlotsForTaskLink: jest.fn().mockResolvedValue([]),
      insertTaskLinkTimetableSlots: jest.fn().mockResolvedValue(undefined),
      assignFollowerCampaignTarget: jest.fn().mockResolvedValue(true),
      lockFollowUpTaskAssignment: jest.fn().mockResolvedValue(null),
      markFollowUpTaskAssigned: jest.fn().mockResolvedValue(true),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
      recordAtomic: jest.fn().mockResolvedValue(undefined),
    };

    service = new TaskLifecycleService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService(taskRepository as unknown as TaskRepository),
      auditLog as unknown as AuditLogService,
      tokenEncryption,
    );
  });

  it('persists structured student name and address fields for manual field visits', async () => {
    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        assigned_to_name: 'ครูเยี่ยมบ้าน',
        assigned_to_email: 'teacher@example.invalid',
        expires_value: 7,
        expires_unit: 'days',
        student_first_name: 'สมชาย',
        student_last_name: 'ใจดี',
        student_school: 'โรงเรียนทดสอบ',
        target_school_id: 10010002,
        address_line: '99/1 หมู่ 2',
        address_province: 'กรุงเทพมหานคร',
        address_district: 'ดุสิต',
        address_sub_district: 'ดุสิต',
        postal_code: '10300',
        reason_flagged: 'ไม่มาเรียนต่อเนื่อง',
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.createCase).toHaveBeenCalledWith(
      expect.objectContaining({
        studentName: 'สมชาย ใจดี',
        studentFirstName: 'สมชาย',
        studentLastName: 'ใจดี',
        studentSchool: 'โรงเรียนทดสอบ',
        studentAddress: '99/1 หมู่ 2 ดุสิต ดุสิต กรุงเทพมหานคร 10300',
        addressLine: '99/1 หมู่ 2',
        addressProvince: 'กรุงเทพมหานคร',
        addressDistrict: 'ดุสิต',
        addressSubDistrict: 'ดุสิต',
        postalCode: '10300',
        schoolId: 10010002,
      }),
      undefined,
    );
    expect(taskRepository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 123,
        targetSchoolId: 10010002,
      }),
      undefined,
    );
    const auditEvent = auditLog.record.mock.calls[0]?.[0];
    expect(auditEvent).toMatchObject({
      action: 'TASK_CREATE',
      actorUserId: 7,
      actorLabel: 'case-admin',
      targetType: 'task',
    });
    expect(typeof auditEvent?.targetId).toBe('string');
    expect(auditEvent?.metadata).toMatchObject({
      taskType: 'VISIT',
      schoolId: 10010002,
      caseId: 123,
    });
  });

  it('binds validated timetable slots when creating an attendance link', async () => {
    taskRepository.listTimetableSlotsForTaskLink.mockResolvedValue([
      {
        id: 11,
        school_id: 10010002,
        grade_level_id: 423,
        grade_label: 'ม.6',
        room_no: 1,
        subject_id: 5,
        day_of_week: 2,
        period: 3,
      },
      {
        id: 12,
        school_id: 10010002,
        grade_level_id: 423,
        grade_label: 'ม.6',
        room_no: 1,
        subject_id: 5,
        day_of_week: 4,
        period: 2,
      },
    ]);

    await service.createTask(
      buildActor(),
      {
        task_type: 'ATTENDANCE',
        assigned_to_name: 'ครูประจำวิชา',
        target_school_id: 10010002,
        target_grade: 'ม.6',
        target_room: '1',
        subject: 'คณิตศาสตร์',
        subject_id: 5,
        timetable_slot_ids: [11, '12'],
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.listTimetableSlotsForTaskLink).toHaveBeenCalledWith([11, 12], undefined);
    const createLinkCall = taskRepository.createTaskLink.mock.calls[0];
    expect(createLinkCall?.[0]).toEqual(expect.objectContaining({ subjectId: 5 }));
    expect(taskRepository.insertTaskLinkTimetableSlots).toHaveBeenCalledWith(
      expect.any(String),
      [11, 12],
      7,
      undefined,
    );
  });

  it('rejects timetable slots outside the attendance link subject scope', async () => {
    taskRepository.listTimetableSlotsForTaskLink.mockResolvedValue([
      {
        id: 11,
        school_id: 10010002,
        grade_level_id: 423,
        grade_label: 'ม.6',
        room_no: 1,
        subject_id: 99,
        day_of_week: 2,
        period: 3,
      },
    ]);

    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'ATTENDANCE',
          assigned_to_name: 'ครูประจำวิชา',
          target_school_id: 10010002,
          target_grade: 'ม.6',
          target_room: '1',
          subject_id: 5,
          timetable_slot_ids: [11],
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('คาบเรียนไม่ตรงกับขอบเขตหรือวิชาของลิงก์');
    expect(taskRepository.createTaskLink).not.toHaveBeenCalled();
    expect(taskRepository.insertTaskLinkTimetableSlots).not.toHaveBeenCalled();
  });

  it('records field follower assignment after creating a VISIT link', async () => {
    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        assigned_to_name: 'อสม ทดสอบ',
        assigned_to_email: 'follower@example.invalid',
        assigned_to_phone: '0812345678',
        student_name: 'เด็กทดสอบ',
        student_school: 'โรงเรียนทดสอบ',
        target_school_id: 10010002,
        source_field_follower_id: 7,
        campaign_target_id: 99,
      },
      'https://app.example.invalid',
    );

    const linkId = taskRepository.createTaskLink.mock.calls[0]?.[0].linkId;
    expect(taskRepository.createTaskLink.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ sourceFieldFollowerId: 7 }),
    );
    expect(taskRepository.assignFollowerCampaignTarget).toHaveBeenCalledWith(
      {
        campaignTargetId: 99,
        sourceFieldFollowerId: 7,
        taskLinkId: linkId,
        caseId: 123,
        actorId: 7,
      },
      undefined,
    );
  });

  it('rejects campaign target assignment if the guarded update loses the race', async () => {
    taskRepository.assignFollowerCampaignTarget.mockResolvedValue(false);

    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'อสม ทดสอบ',
          assigned_to_email: 'follower@example.invalid',
          student_name: 'เด็กทดสอบ',
          target_school_id: 10010002,
          source_field_follower_id: 7,
          campaign_target_id: 99,
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('ไม่สามารถมอบหมายเคสนี้ได้');
  });

  it('consumes an approved follow-up exactly when creating the visit task', async () => {
    taskRepository.lockFollowUpTaskAssignment.mockResolvedValue({
      id: followUpRequestId,
      student_uuid: studentUuid,
      school_id: 10010002,
      status: 'APPROVE_AND_ASSIGN',
      assigned_task_id: null,
      assigned_by: null,
      assigned_at: null,
      assigned_case_id: null,
      assigned_link_token_encrypted: null,
      assigned_link_expires_at: null,
    });

    const result = await service.createTask(
      {
        ...buildActor(),
        permissions: ['create', 'assign-follow-up-cases'],
      },
      {
        task_type: 'VISIT',
        assigned_to_name: 'ครูผู้ติดตาม',
        assigned_to_email: 'teacher@example.invalid',
        student_id: studentUuid,
        student_name: 'เด็กทดสอบ',
        target_school_id: 10010002,
        follow_up_request_id: followUpRequestId,
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.markFollowUpTaskAssigned).toHaveBeenCalledWith(
      followUpRequestId,
      result.task_id,
      7,
      undefined,
    );
    const atomicEvent = auditLog.recordAtomic.mock.calls[0]?.[0];
    expect(atomicEvent).toMatchObject({
      action: 'STUDENT_OBSERVATION_UPDATE',
      targetId: followUpRequestId,
      metadata: {
        operation: 'STUDENT_FOLLOW_UP_REQUEST_ASSIGN',
        taskId: result.task_id,
      },
    });
    expect(result).toMatchObject({
      follow_up_request_id: followUpRequestId,
      reused: false,
    });
  });

  it('returns the existing task link when the approved follow-up was already consumed', async () => {
    const assignedTaskId = '33333333-3333-4333-8333-333333333333';
    taskRepository.lockFollowUpTaskAssignment.mockResolvedValue({
      id: followUpRequestId,
      student_uuid: studentUuid,
      school_id: 10010002,
      status: 'APPROVE_AND_ASSIGN',
      assigned_task_id: assignedTaskId,
      assigned_by: 7,
      assigned_at: '2026-07-15T04:00:00.000Z',
      assigned_case_id: 123,
      assigned_link_token_encrypted: tokenEncryption.encrypt('existing-token'),
      assigned_link_expires_at: '2026-07-22T04:00:00.000Z',
    });

    const result = await service.createTask(
      {
        ...buildActor(),
        permissions: ['create', 'assign-follow-up-cases'],
      },
      {
        task_type: 'VISIT',
        assigned_to_name: 'ครูผู้ติดตาม',
        student_id: studentUuid,
        student_name: 'เด็กทดสอบ',
        target_school_id: 10010002,
        follow_up_request_id: followUpRequestId,
      },
      'https://app.example.invalid',
    );

    expect(result).toMatchObject({
      task_id: assignedTaskId,
      magic_link: 'https://app.example.invalid/task/existing-token',
      reused: true,
    });
    expect(taskRepository.createCase).not.toHaveBeenCalled();
    expect(taskRepository.createTask).not.toHaveBeenCalled();
    expect(taskRepository.createTaskLink).not.toHaveBeenCalled();
    expect(taskRepository.markFollowUpTaskAssigned).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('requires the dedicated follow-up assignment permission', async () => {
    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'ครูผู้ติดตาม',
          student_id: studentUuid,
          student_name: 'เด็กทดสอบ',
          target_school_id: 10010002,
          follow_up_request_id: followUpRequestId,
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('ไม่มีสิทธิ์มอบหมายผู้ติดตามเคส');
    expect(taskRepository.lockFollowUpTaskAssignment).not.toHaveBeenCalled();
  });
});
