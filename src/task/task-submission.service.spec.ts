import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { AttendanceWriteService } from '../attendance/attendance-write.service';
import { getBangkokDateString } from '../common/utils/date.util';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import { TaskSubmissionService } from './task-submission.service';

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
    >
  >;
  let attendanceWriteService: jest.Mocked<
    Pick<AttendanceWriteService, 'saveAttendanceGroupsWithinTransaction'>
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
    };
    attendanceWriteService = {
      saveAttendanceGroupsWithinTransaction: jest
        .fn()
        .mockResolvedValue([{ calendarConfigured: false, affectedStudentIds: STUDENT_IDS }]),
    };

    service = new TaskSubmissionService(
      taskRepository as unknown as TaskRepository,
      taskAccessService as unknown as TaskAccessService,
      {} as AutomationService,
      attendanceWriteService as unknown as AttendanceWriteService,
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
});
