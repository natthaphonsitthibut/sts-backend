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
      | 'listVisitAssignees'
      | 'lockCaseForVisitAssignment'
      | 'findActiveCaseByStudentUuid'
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
      listVisitAssignees: jest.fn().mockResolvedValue([]),
      lockCaseForVisitAssignment: jest.fn().mockResolvedValue({
        id: 123,
        school_id: 10010002,
        student_uuid: studentUuid,
        status: 'OPEN',
        has_live_assignment: false,
      }),
      findActiveCaseByStudentUuid: jest.fn().mockResolvedValue(null),
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

  it('lists only the selected student school teachers and preserves the homeroom default flag', async () => {
    taskRepository.findStudentTermMetadata.mockResolvedValue({ SchoolID_Onec: 10010002 });
    taskRepository.listVisitAssignees.mockResolvedValue([
      {
        teacher_user_id: 42,
        display_name: 'ครูประจำชั้น',
        email: 'homeroom@example.test',
        is_homeroom: true,
      },
      {
        teacher_user_id: 43,
        display_name: 'ครูในโรงเรียน',
        email: 'teacher@example.test',
        is_homeroom: false,
      },
    ]);

    await expect(service.listVisitAssignees(buildActor(), studentUuid)).resolves.toEqual([
      { teacherUserId: 42, displayName: 'ครูประจำชั้น', isHomeroom: true },
      { teacherUserId: 43, displayName: 'ครูในโรงเรียน', isHomeroom: false },
    ]);
    expect(taskRepository.listVisitAssignees).toHaveBeenCalledWith(studentUuid);
  });

  it('allows a selected school teacher without an email address', async () => {
    taskRepository.listVisitAssignees.mockResolvedValue([
      {
        teacher_user_id: 42,
        display_name: 'ครูประจำชั้น',
        email: null,
        is_homeroom: true,
      },
    ]);

    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        student_id: studentUuid,
        student_name: 'นักเรียนทดสอบ',
        target_school_id: 10010002,
        existing_case_id: '123',
        assigned_teacher_user_id: 42,
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.createTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToName: 'ครูประจำชั้น',
        assignedToEmail: null,
        otpVerified: 1,
      }),
      undefined,
    );
  });

  it('persists structured student name and address fields for manual field visits', async () => {
    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        assigned_to_first_name: 'ครูเยี่ยม',
        assigned_to_last_name: 'บ้าน',
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
    expect(taskRepository.createTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedToName: 'ครูเยี่ยม บ้าน',
        assignedToFirstName: 'ครูเยี่ยม',
        assignedToLastName: 'บ้าน',
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

  it('uses the explicit start and end timestamps for a visit assignment', async () => {
    const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const expiresAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();

    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        assigned_to_name: 'ครูเยี่ยมบ้าน',
        student_name: 'นักเรียนทดสอบ',
        target_school_id: 10010002,
        opens_at: opensAt,
        expires_at: expiresAt,
        assignment_note: 'ติดตามการขาดเรียนและประสานผู้ปกครอง',
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.createTaskLink).toHaveBeenCalledWith(
      expect.objectContaining({
        opensAt,
        expiresAt,
        assignmentNote: 'ติดตามการขาดเรียนและประสานผู้ปกครอง',
      }),
      undefined,
    );
  });

  it.each(['PENDING_REVIEW', 'RESOLVED'])(
    'rejects assigning an existing %s case',
    async (status) => {
      taskRepository.lockCaseForVisitAssignment.mockResolvedValueOnce({
        id: 123,
        school_id: 10010002,
        student_uuid: studentUuid,
        status,
        has_live_assignment: false,
      });

      await expect(
        service.createTask(
          buildActor(),
          {
            task_type: 'VISIT',
            assigned_to_name: 'ครูผู้ติดตาม',
            existing_case_id: '123',
            student_id: studentUuid,
            student_name: 'นักเรียนทดสอบ',
            target_school_id: 10010002,
          },
          'https://app.example.invalid',
        ),
      ).rejects.toThrow('สถานะเคสนี้ไม่อนุญาตให้มอบหมายการติดตาม');
      expect(taskRepository.createTask).not.toHaveBeenCalled();
    },
  );

  it('rejects a duplicate assignment while an unexpired link is active', async () => {
    taskRepository.lockCaseForVisitAssignment.mockResolvedValueOnce({
      id: 123,
      school_id: 10010002,
      student_uuid: studentUuid,
      status: 'IN_PROGRESS',
      has_live_assignment: true,
    });

    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'ครูผู้ติดตาม',
          existing_case_id: '123',
          student_id: studentUuid,
          student_name: 'นักเรียนทดสอบ',
          target_school_id: 10010002,
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('เคสนี้มีลิงก์มอบหมายที่ยังใช้งานได้อยู่แล้ว');
    expect(taskRepository.createTask).not.toHaveBeenCalled();
  });

  it.each(['OPEN', 'IN_PROGRESS', 'STUDENT_NOT_FOUND'])(
    'allows assignment for a %s case without a live link',
    async (status) => {
      taskRepository.lockCaseForVisitAssignment.mockResolvedValueOnce({
        id: 123,
        school_id: 10010002,
        student_uuid: studentUuid,
        status,
        has_live_assignment: false,
      });

      await expect(
        service.createTask(
          buildActor(),
          {
            task_type: 'VISIT',
            assigned_to_name: 'ครูผู้ติดตาม',
            existing_case_id: '123',
            student_id: studentUuid,
            student_name: 'นักเรียนทดสอบ',
            target_school_id: 10010002,
          },
          'https://app.example.invalid',
        ),
      ).resolves.toEqual(expect.objectContaining({ reused: false }));
      expect(taskRepository.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 123 }),
        undefined,
      );
    },
  );

  it('reuses an active student case when creating a visit task', async () => {
    taskRepository.findActiveCaseByStudentUuid.mockResolvedValueOnce({ id: 456 });

    await service.createTask(
      buildActor(),
      {
        task_type: 'VISIT',
        assigned_to_name: 'ครูผู้ติดตาม',
        student_id: studentUuid,
        student_name: 'นักเรียนทดสอบ',
        target_school_id: 10010002,
      },
      'https://app.example.invalid',
    );

    expect(taskRepository.findActiveCaseByStudentUuid).toHaveBeenCalledWith(
      studentUuid,
      buildActor(),
      undefined,
    );
    expect(taskRepository.createCase).not.toHaveBeenCalled();
    expect(taskRepository.updateCaseStatus).toHaveBeenCalledWith(
      456,
      'IN_PROGRESS',
      undefined,
      buildActor(),
    );
    expect(taskRepository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 456 }),
      undefined,
    );
  });

  it('rejects a visit assignment whose explicit end is not after its start', async () => {
    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'ครูเยี่ยมบ้าน',
          student_name: 'นักเรียนทดสอบ',
          target_school_id: 10010002,
          opens_at: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('เวลาที่เปิดใช้งานต้องอยู่ก่อนเวลาหมดอายุของลิงก์');
  });

  it('rejects a link lifetime beyond the shared 90-day ceiling', async () => {
    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'ครูเยี่ยมบ้าน',
          student_name: 'นักเรียนทดสอบ',
          target_school_id: 10010002,
          expires_at: new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString(),
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('อายุลิงก์ต้องไม่เกิน 90 วัน');

    await expect(
      service.createTask(
        buildActor(),
        {
          task_type: 'VISIT',
          assigned_to_name: 'ครูเยี่ยมบ้าน',
          student_name: 'นักเรียนทดสอบ',
          target_school_id: 10010002,
          expires_value: 100,
          expires_unit: 'days',
        },
        'https://app.example.invalid',
      ),
    ).rejects.toThrow('อายุลิงก์ต้องไม่เกิน 90 วัน');
  });

  it('refuses to create a per-classroom attendance link now that teacher links replace them', async () => {
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
    ).rejects.toThrow('ลิงก์เช็คชื่อรายห้องถูกยกเลิกแล้ว');
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

  it('rejects the retired follow-up request field instead of ignoring it', async () => {
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
    ).rejects.toThrow('ระบบไม่รองรับคำขอติดตามแล้ว');
    expect(taskRepository.createTask).not.toHaveBeenCalled();
  });
});
