import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

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
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

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
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new TaskLifecycleService(
      taskRepository as unknown as TaskRepository,
      new TaskPolicyService(taskRepository as unknown as TaskRepository),
      auditLog as unknown as AuditLogService,
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
});
