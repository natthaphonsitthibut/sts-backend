import { BadRequestException, ConflictException } from '@nestjs/common';
import { getBangkokDateString, getIsoDayOfWeekFromDateString } from '../common/utils/date.util';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import type { AttendanceSessionRow } from './attendance-operations.types';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceWriteService } from './attendance-write.service';

const STUDENT_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
];
const TEST_ATTENDANCE_DATE = getBangkokDateString();
const TEST_DAY_OF_WEEK = (() => {
  const [year, month, day] = TEST_ATTENDANCE_DATE.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
})();

const buildSession = (overrides: Partial<AttendanceSessionRow> = {}): AttendanceSessionRow => ({
  id: '10000000-0000-4000-8000-000000000001',
  school_term_id: '10',
  school_id: 10010002,
  grade_level_id: 6,
  room_id: 1,
  attendance_date: TEST_ATTENDANCE_DATE,
  period: 1,
  session_kind: 'DAILY',
  status: 'OPEN',
  expected_roster_count: 2,
  recorded_count: 0,
  revision: 1,
  submitted_at: null,
  correction_reason: null,
  ...overrides,
});

describe('AttendanceWriteService', () => {
  const executor = { query: jest.fn() };
  let attendanceRepository: jest.Mocked<
    Pick<
      AttendanceRepository,
      | 'filterStudentIdsInScope'
      | 'upsertAttendanceBatch'
      | 'listAttendanceStatuses'
      | 'getAlertTriggerType'
    >
  >;
  let riskProfileService: { enqueueStudents: jest.Mock };
  let operationsRepository: jest.Mocked<
    Pick<
      AttendanceOperationsRepository,
      | 'findClassMetadata'
      | 'listRosterIds'
      | 'findOrCreateTermForClass'
      | 'findOrCreateSessionForUpdate'
      | 'updateSessionSubmitted'
      | 'recordSessionAudit'
      | 'withTransaction'
    >
  >;
  let service: AttendanceWriteService;

  beforeEach(() => {
    attendanceRepository = {
      filterStudentIdsInScope: jest.fn().mockResolvedValue(STUDENT_IDS),
      upsertAttendanceBatch: jest.fn().mockResolvedValue(undefined),
      listAttendanceStatuses: jest.fn().mockResolvedValue([]),
      getAlertTriggerType: jest.fn().mockResolvedValue('SCHEDULED'),
    };
    riskProfileService = { enqueueStudents: jest.fn().mockResolvedValue(undefined) };
    operationsRepository = {
      findClassMetadata: jest.fn().mockResolvedValue(
        STUDENT_IDS.map((studentUuid) => ({
          student_uuid: studentUuid,
          school_id: 10010002,
          grade_level_id: 6,
          grade_label: 'ม.6',
          room_id: 1,
          academic_year: 2569,
          semester: 1,
        })),
      ),
      listRosterIds: jest.fn().mockResolvedValue(STUDENT_IDS),
      findOrCreateTermForClass: jest.fn().mockResolvedValue({
        id: '10',
        school_id: 10010002,
        school_name: 'โรงเรียนทดสอบ',
        academic_year: 2569,
        semester: 1,
        starts_on: null,
        ends_on: null,
        status: 'DRAFT',
        calendar_day_count: 0,
        school_day_count: 0,
      }),
      findOrCreateSessionForUpdate: jest.fn().mockResolvedValue(buildSession()),
      updateSessionSubmitted: jest.fn().mockResolvedValue(undefined),
      recordSessionAudit: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(async (callback) => await callback(executor)),
    };
    service = new AttendanceWriteService(
      attendanceRepository as unknown as AttendanceRepository,
      operationsRepository as unknown as AttendanceOperationsRepository,
      { checkConsecutiveAbsences: jest.fn() } as never,
      riskProfileService as never,
    );
  });

  it('submits one complete class and writes the session audit', async () => {
    const result = await service.saveAttendanceWithinTransaction(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
    );

    expect(result).toEqual({
      session: {
        id: '10000000-0000-4000-8000-000000000001',
        status: 'SUBMITTED',
        revision: 1,
      },
      calendarConfigured: false,
      affectedStudentIds: STUDENT_IDS,
    });
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledTimes(1);
    expect(operationsRepository.updateSessionSubmitted).toHaveBeenCalledTimes(1);
    expect(operationsRepository.recordSessionAudit).toHaveBeenCalledTimes(1);
  });

  it('persists leave with attendance status code 4', async () => {
    await service.saveAttendanceWithinTransaction(
      [
        { student_id: STUDENT_IDS[0], status: 'P_LEAVE' },
        { student_id: STUDENT_IDS[1], status: 'P_PRESENT' },
      ],
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
    );

    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledWith(
      expect.objectContaining({ statusCodes: [4, 1] }),
      executor,
    );
  });

  it('enqueues risk profile recalculation after attendance is committed', async () => {
    await service.saveAttendance(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      { id: 5, username: 'teacher', roles: ['TEACHER'], permissions: ['attendance'] },
    );

    expect(riskProfileService.enqueueStudents).toHaveBeenCalledWith(STUDENT_IDS, 'attendance-save');
  });

  it('rejects a stale partial roster before writing attendance', async () => {
    operationsRepository.listRosterIds.mockResolvedValue([
      ...STUDENT_IDS,
      '00000000-0000-4000-8000-000000000003',
    ]);

    await expect(
      service.saveAttendanceWithinTransaction(
        STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
        { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('requires reopen before replacing a submitted session', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession({
        status: 'SUBMITTED',
      }),
    );

    await expect(
      service.saveAttendanceWithinTransaction(
        STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
        { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('records changed student statuses when submitting a reopened session', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession({
        status: 'REOPENED',
        revision: 2,
        correction_reason: 'แก้สถานะตามหลักฐาน',
      }),
    );
    attendanceRepository.listAttendanceStatuses.mockResolvedValue([
      { student_uuid: STUDENT_IDS[0], attendance_status: 1 },
      { student_uuid: STUDENT_IDS[1], attendance_status: 2 },
    ]);

    await service.saveAttendanceWithinTransaction(
      [
        { student_id: STUDENT_IDS[0], status: 'P_ABSENT' },
        { student_id: STUDENT_IDS[1], status: 'P_ABSENT' },
      ],
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
    );

    expect(operationsRepository.recordSessionAudit).toHaveBeenCalledWith(
      {
        action: 'ATTENDANCE_SUBMIT',
        sessionId: '10000000-0000-4000-8000-000000000001',
        actorUserId: 5,
        actorLabel: 'teacher',
        metadata: {
          schoolId: 10010002,
          gradeLevelId: 6,
          roomId: 1,
          attendanceDate: TEST_ATTENDANCE_DATE,
          sessionKind: 'DAILY',
          period: 1,
          subjectId: null,
          timetableSlotId: null,
          expectedRosterCount: 2,
          recordedCount: 2,
          revision: 2,
          correctionReason: 'แก้สถานะตามหลักฐาน',
          correctionChanges: [
            {
              studentUuid: STUDENT_IDS[0],
              previousStatusCode: 1,
              nextStatusCode: 2,
            },
          ],
        },
      },
      executor,
    );
  });

  it('submits subject attendance with subject session metadata', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession({
        period: 3,
        session_kind: 'SUBJECT',
      }),
    );

    await service.saveAttendanceWithinTransaction(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      {
        actorUserId: null,
        actorLabel: 'task-link:link-1',
        recorder: 'subject-teacher',
        session: {
          kind: 'SUBJECT',
          period: 3,
          subjectId: 5,
          timetableSlotId: 11,
        },
      },
      executor,
    );

    expect(operationsRepository.findOrCreateSessionForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        period: 3,
        sessionKind: 'SUBJECT',
        subjectId: 5,
        timetableSlotId: 11,
      }),
      2,
      null,
      executor,
    );
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        period: 3,
        sessionKind: 'SUBJECT',
        recordedBy: 'subject-teacher',
      }),
      executor,
    );
    const auditInput = operationsRepository.recordSessionAudit.mock.calls[0]?.[0] as
      | { metadata?: Record<string, unknown> }
      | undefined;
    expect(auditInput?.metadata).toMatchObject({
      sessionKind: 'SUBJECT',
      period: 3,
      subjectId: 5,
      timetableSlotId: 11,
    });
  });

  it('resolves direct check-in timetable slot as a subject session', async () => {
    executor.query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: TEST_DAY_OF_WEEK,
          period: 3,
          subject_id: 5,
        },
      ],
    });
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession({
        period: 3,
        session_kind: 'SUBJECT',
      }),
    );

    await service.saveAttendanceWithinTransaction(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      {
        actorUserId: 7,
        actorLabel: 'teacher',
        recorder: 'teacher',
      },
      executor,
      undefined,
      11,
    );

    expect(operationsRepository.findOrCreateSessionForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        period: 3,
        sessionKind: 'SUBJECT',
        subjectId: 5,
        timetableSlotId: 11,
      }),
      2,
      7,
      executor,
    );
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        period: 3,
        sessionKind: 'SUBJECT',
        recordedBy: 'teacher',
      }),
      executor,
    );
  });

  it('resolves a direct check-in timetable slot against the backdated date, not today', async () => {
    const pastDate = '2024-01-08'; // Monday — deliberately not "today" in test runs
    const pastDayOfWeek = getIsoDayOfWeekFromDateString(pastDate);
    executor.query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: pastDayOfWeek,
          period: 3,
          subject_id: 5,
        },
      ],
    });
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession({ period: 3, session_kind: 'SUBJECT', attendance_date: pastDate }),
    );

    await service.saveAttendanceWithinTransaction(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      { actorUserId: 7, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      11,
      pastDate,
    );

    expect(operationsRepository.findOrCreateSessionForUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceDate: pastDate, period: 3, sessionKind: 'SUBJECT' }),
      2,
      7,
      executor,
    );
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledWith(
      expect.objectContaining({ date: pastDate }),
      executor,
    );
  });

  it('rejects a direct check-in slot whose weekday does not match the backdated date', async () => {
    const pastDate = '2024-01-08'; // Monday
    const wrongDayOfWeek = (getIsoDayOfWeekFromDateString(pastDate) % 7) + 1;
    executor.query.mockResolvedValueOnce({
      rows: [
        {
          id: 11,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: wrongDayOfWeek,
          period: 3,
          subject_id: 5,
        },
      ],
    });

    await expect(
      service.saveAttendanceWithinTransaction(
        STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
        { actorUserId: 7, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
        undefined,
        11,
        pastDate,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('rejects saving attendance for a future date before opening a transaction', async () => {
    const [year, month, day] = getBangkokDateString().split('-').map(Number);
    const futureDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);

    await expect(
      service.saveAttendance(
        STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
        { id: 5, username: 'teacher', roles: ['TEACHER'], permissions: ['attendance'] },
        undefined,
        futureDate,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(operationsRepository.withTransaction).not.toHaveBeenCalled();
  });
});
