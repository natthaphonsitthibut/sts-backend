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
const TEST_TIMETABLE_SLOT_ID = 11;
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
  period: 3,
  session_kind: 'SUBJECT',
  status: 'OPEN',
  expected_roster_count: 2,
  recorded_count: 0,
  revision: 1,
  submitted_at: null,
  correction_reason: null,
  ...overrides,
});

describe('AttendanceWriteService', () => {
  const executor = {
    query: jest.fn().mockResolvedValue({
      rows: [
        {
          id: TEST_TIMETABLE_SLOT_ID,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: TEST_DAY_OF_WEEK,
          period: 3,
          subject_id: 5,
        },
      ],
    }),
  };
  let attendanceRepository: jest.Mocked<
    Pick<
      AttendanceRepository,
      'filterStudentIdsInScope' | 'upsertAttendanceBatch' | 'getAlertTriggerType'
    >
  >;
  let riskProfileService: { requestStudentRecalculation: jest.Mock };
  let operationsRepository: jest.Mocked<
    Pick<
      AttendanceOperationsRepository,
      | 'findClassMetadata'
      | 'listRosterIds'
      | 'findOrCreateTermForClass'
      | 'findOrCreateSessionForUpdate'
      | 'updateSessionSubmitted'
      | 'recordSessionAudit'
      | 'findReopenBaseline'
      | 'listSessionAttendanceStatuses'
      | 'withTransaction'
    >
  >;
  let service: AttendanceWriteService;

  beforeEach(() => {
    attendanceRepository = {
      filterStudentIdsInScope: jest.fn().mockResolvedValue(STUDENT_IDS),
      upsertAttendanceBatch: jest.fn().mockResolvedValue(undefined),
      getAlertTriggerType: jest.fn().mockResolvedValue('SCHEDULED'),
    };
    riskProfileService = { requestStudentRecalculation: jest.fn().mockResolvedValue(undefined) };
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
      findReopenBaseline: jest.fn().mockResolvedValue(null),
      listSessionAttendanceStatuses: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (callback) => await callback(executor)),
    };
    service = new AttendanceWriteService(
      attendanceRepository as unknown as AttendanceRepository,
      operationsRepository as unknown as AttendanceOperationsRepository,
      { checkConsecutiveAbsences: jest.fn() } as never,
      riskProfileService as never,
    );
  });

  it('rejects a direct attendance write without a timetable subject slot', async () => {
    await expect(
      service.saveAttendanceWithinTransaction(
        STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
        { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(operationsRepository.findOrCreateSessionForUpdate).not.toHaveBeenCalled();
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('submits one complete class and writes the session audit', async () => {
    const result = await service.saveAttendanceWithinTransaction(
      STUDENT_IDS.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      TEST_TIMETABLE_SLOT_ID,
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
      undefined,
      TEST_TIMETABLE_SLOT_ID,
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
      TEST_TIMETABLE_SLOT_ID,
    );

    expect(riskProfileService.requestStudentRecalculation).toHaveBeenCalledWith(
      STUDENT_IDS,
      'attendance-save',
    );
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
        undefined,
        TEST_TIMETABLE_SLOT_ID,
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
        undefined,
        TEST_TIMETABLE_SLOT_ID,
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
    operationsRepository.findReopenBaseline.mockResolvedValue([
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
      undefined,
      TEST_TIMETABLE_SLOT_ID,
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
          sessionKind: 'SUBJECT',
          period: 3,
          subjectId: 5,
          timetableSlotId: TEST_TIMETABLE_SLOT_ID,
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
    expect(operationsRepository.listSessionAttendanceStatuses).not.toHaveBeenCalled();
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

describe('AttendanceWriteService marked_at clamping', () => {
  const executor = {
    query: jest.fn().mockResolvedValue({
      rows: [
        {
          id: TEST_TIMETABLE_SLOT_ID,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: TEST_DAY_OF_WEEK,
          period: 3,
          subject_id: 5,
        },
      ],
    }),
  };
  let attendanceRepository: jest.Mocked<
    Pick<
      AttendanceRepository,
      'filterStudentIdsInScope' | 'upsertAttendanceBatch' | 'getAlertTriggerType'
    >
  >;
  let service: AttendanceWriteService;

  const markedAtFor = (rawMarkedAt: string | undefined): string | null => {
    const call = attendanceRepository.upsertAttendanceBatch.mock.calls.at(-1);
    void rawMarkedAt;
    return (call?.[0].markedAt ?? [])[0] ?? null;
  };

  const save = async (marked_at?: string) =>
    await service.saveAttendanceWithinTransaction(
      [{ student_id: STUDENT_IDS[0], status: 'P_PRESENT', marked_at }],
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      TEST_TIMETABLE_SLOT_ID,
    );

  beforeEach(() => {
    attendanceRepository = {
      filterStudentIdsInScope: jest.fn().mockResolvedValue([STUDENT_IDS[0]]),
      upsertAttendanceBatch: jest.fn().mockResolvedValue(undefined),
      getAlertTriggerType: jest.fn().mockResolvedValue('SCHEDULED'),
    };
    const operationsRepository = {
      findClassMetadata: jest.fn().mockResolvedValue([
        {
          student_uuid: STUDENT_IDS[0],
          school_id: 10010002,
          grade_level_id: 6,
          grade_label: 'ม.6',
          room_id: 1,
          academic_year: 2569,
          semester: 1,
        },
      ]),
      listRosterIds: jest.fn().mockResolvedValue([STUDENT_IDS[0]]),
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
      findOrCreateSessionForUpdate: jest
        .fn()
        .mockResolvedValue(buildSession({ expected_roster_count: 1 })),
      updateSessionSubmitted: jest.fn().mockResolvedValue(undefined),
      recordSessionAudit: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(
        async (callback: (executor: typeof executor) => Promise<unknown>) =>
          await callback(executor),
      ),
    };
    service = new AttendanceWriteService(
      attendanceRepository as unknown as AttendanceRepository,
      operationsRepository as unknown as AttendanceOperationsRepository,
      { checkConsecutiveAbsences: jest.fn() } as never,
      { requestStudentRecalculation: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  it('stores NULL when the client sends no mark time', async () => {
    await save();
    expect(markedAtFor(undefined)).toBeNull();
  });

  it('stores NULL when the client sends an unparsable mark time', async () => {
    await save('not-a-timestamp');
    expect(markedAtFor('not-a-timestamp')).toBeNull();
  });

  it('keeps a mark time that already sits inside the attendance day', async () => {
    // Two minutes ago is inside today's Bangkok day for every wall-clock time
    // except the first two minutes after midnight, which the clamp floors anyway.
    const marked = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await save(marked);
    const stored = markedAtFor(marked);
    expect(stored).not.toBeNull();
    expect(new Date(stored as string).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('clamps a future mark time down so a skewed device clock cannot write ahead', async () => {
    const before = Date.now();
    await save(new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString());
    const stored = markedAtFor(undefined);
    expect(stored).not.toBeNull();
    expect(new Date(stored as string).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(stored as string).getTime()).toBeGreaterThanOrEqual(before - 1_000);
  });

  it('clamps a mark time from before the attendance day up to its start', async () => {
    await save('2020-01-01T08:00:00.000Z');
    const stored = markedAtFor(undefined);
    expect(stored).toBe(new Date(`${TEST_ATTENDANCE_DATE}T00:00:00.000+07:00`).toISOString());
  });

  it('never writes a mark time after the row is recorded', async () => {
    await save(new Date(Date.now() + 60_000).toISOString());
    const stored = markedAtFor(undefined);
    expect(new Date(stored as string).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('AttendanceWriteService draft marks', () => {
  const executor = {
    query: jest.fn().mockResolvedValue({
      rows: [
        {
          id: TEST_TIMETABLE_SLOT_ID,
          school_term_id: 10,
          school_id: 10010002,
          grade_level_id: 6,
          room_no: 1,
          day_of_week: TEST_DAY_OF_WEEK,
          period: 3,
          subject_id: 5,
        },
      ],
    }),
  };
  let attendanceRepository: jest.Mocked<
    Pick<
      AttendanceRepository,
      | 'filterStudentIdsInScope'
      | 'upsertAttendanceBatch'
      | 'deleteAttendanceMarks'
      | 'getAlertTriggerType'
    >
  >;
  let operationsRepository: jest.Mocked<
    Pick<
      AttendanceOperationsRepository,
      | 'findClassMetadata'
      | 'listRosterIds'
      | 'findTermForClass'
      | 'findOrCreateTermForClass'
      | 'findOrCreateSessionForUpdate'
      | 'updateSessionSubmitted'
      | 'updateSessionDraftProgress'
      | 'recordSessionAudit'
      | 'withTransaction'
    >
  >;
  let riskProfileService: { requestStudentRecalculation: jest.Mock };
  let automationService: { checkConsecutiveAbsences: jest.Mock };
  let service: AttendanceWriteService;

  const term = {
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
  };

  const draft = async (studentIds: string[], sessionOverrides = {}) => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(
      buildSession(sessionOverrides),
    );
    return await service.saveDraftMarksWithinTransaction(
      studentIds.map((studentId) => ({ student_id: studentId, status: 'P_PRESENT' })),
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      TEST_TIMETABLE_SLOT_ID,
    );
  };

  beforeEach(() => {
    attendanceRepository = {
      filterStudentIdsInScope: jest.fn().mockImplementation((ids: string[]) => ids),
      upsertAttendanceBatch: jest.fn().mockResolvedValue(undefined),
      deleteAttendanceMarks: jest.fn().mockResolvedValue(undefined),
      getAlertTriggerType: jest.fn().mockResolvedValue('IMMEDIATE'),
    };
    riskProfileService = { requestStudentRecalculation: jest.fn().mockResolvedValue(undefined) };
    automationService = { checkConsecutiveAbsences: jest.fn().mockResolvedValue([]) };
    operationsRepository = {
      findClassMetadata: jest.fn().mockImplementation((ids: string[]) =>
        ids.map((studentUuid) => ({
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
      findTermForClass: jest.fn().mockResolvedValue(term),
      findOrCreateTermForClass: jest.fn().mockResolvedValue(term),
      findOrCreateSessionForUpdate: jest.fn().mockResolvedValue(buildSession()),
      updateSessionSubmitted: jest.fn().mockResolvedValue(undefined),
      updateSessionDraftProgress: jest.fn().mockResolvedValue(1),
      recordSessionAudit: jest.fn().mockResolvedValue(undefined),
      withTransaction: jest.fn(async (callback) => await callback(executor)),
    };
    service = new AttendanceWriteService(
      attendanceRepository as unknown as AttendanceRepository,
      operationsRepository as unknown as AttendanceOperationsRepository,
      automationService as never,
      riskProfileService as never,
    );
  });

  it('accepts a subset of the roster instead of demanding the whole class', async () => {
    const result = await draft([STUDENT_IDS[0]]);

    expect(result.expectedRosterCount).toBe(2);
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledTimes(1);
    expect(attendanceRepository.upsertAttendanceBatch.mock.calls[0][0].studentIds).toEqual([
      STUDENT_IDS[0],
    ]);
  });

  it('leaves the session open and never marks it submitted', async () => {
    const result = await draft([STUDENT_IDS[0]]);

    expect(result.session.status).toBe('OPEN');
    expect(operationsRepository.updateSessionSubmitted).not.toHaveBeenCalled();
    expect(operationsRepository.updateSessionDraftProgress).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000001',
      5,
      executor,
    );
  });

  it('writes no audit row and triggers no recalculation or absence scan', async () => {
    await draft([STUDENT_IDS[0]]);

    expect(operationsRepository.recordSessionAudit).not.toHaveBeenCalled();
    expect(riskProfileService.requestStudentRecalculation).not.toHaveBeenCalled();
    expect(automationService.checkConsecutiveAbsences).not.toHaveBeenCalled();
  });

  it('reports progress from the row count so it survives incremental saves', async () => {
    operationsRepository.updateSessionDraftProgress.mockResolvedValue(2);
    const result = await draft([STUDENT_IDS[0]]);

    // One student sent, two already on the session — the count comes from the
    // table, not from the size of this payload.
    expect(result.recordedCount).toBe(2);
  });

  it('reads the term without taking the find-or-create lock', async () => {
    await draft([STUDENT_IDS[0]]);

    expect(operationsRepository.findTermForClass).toHaveBeenCalled();
    expect(operationsRepository.findOrCreateTermForClass).not.toHaveBeenCalled();
  });

  it('falls back to find-or-create when the term does not exist yet', async () => {
    operationsRepository.findTermForClass.mockResolvedValue(null);
    await draft([STUDENT_IDS[0]]);

    expect(operationsRepository.findOrCreateTermForClass).toHaveBeenCalled();
  });

  it('refuses a student outside the class roster', async () => {
    await expect(draft(['00000000-0000-4000-8000-000000000009'])).rejects.toThrow(
      'พบนักเรียนที่ไม่อยู่ใน roster ของห้องนี้',
    );
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('refuses to draft into a submitted round', async () => {
    await expect(draft([STUDENT_IDS[0]], { status: 'SUBMITTED' })).rejects.toThrow(
      'รอบนี้ส่งแล้ว กรุณาเปิดแก้ไขพร้อมระบุเหตุผลก่อน',
    );
  });

  it('refuses to draft into a voided round', async () => {
    await expect(draft([STUDENT_IDS[0]], { status: 'VOIDED' })).rejects.toThrow(
      'รอบเช็กชื่อนี้ถูกยกเลิกแล้ว',
    );
  });

  it('deletes the stored row when a teacher takes a mark back', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(buildSession());
    await service.saveDraftMarksWithinTransaction(
      [],
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      TEST_TIMETABLE_SLOT_ID,
      undefined,
      [STUDENT_IDS[0]],
    );

    expect(attendanceRepository.deleteAttendanceMarks).toHaveBeenCalledWith(
      { sessionId: '10000000-0000-4000-8000-000000000001', studentIds: [STUDENT_IDS[0]] },
      executor,
    );
    // Nothing to upsert when the payload is a pure clear.
    expect(attendanceRepository.upsertAttendanceBatch).not.toHaveBeenCalled();
  });

  it('scope-checks cleared students exactly like marked ones', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(buildSession());
    await expect(
      service.saveDraftMarksWithinTransaction(
        [],
        { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
        undefined,
        TEST_TIMETABLE_SLOT_ID,
        undefined,
        ['00000000-0000-4000-8000-000000000009'],
      ),
    ).rejects.toThrow('พบนักเรียนที่ไม่อยู่ใน roster ของห้องนี้');
    expect(attendanceRepository.deleteAttendanceMarks).not.toHaveBeenCalled();
  });

  it('applies a clear and a mark from the same batch', async () => {
    operationsRepository.findOrCreateSessionForUpdate.mockResolvedValue(buildSession());
    await service.saveDraftMarksWithinTransaction(
      [{ student_id: STUDENT_IDS[1], status: 'P_ABSENT' }],
      { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
      executor,
      undefined,
      TEST_TIMETABLE_SLOT_ID,
      undefined,
      [STUDENT_IDS[0]],
    );

    expect(attendanceRepository.deleteAttendanceMarks).toHaveBeenCalledWith(
      expect.objectContaining({ studentIds: [STUDENT_IDS[0]] }),
      executor,
    );
    expect(attendanceRepository.upsertAttendanceBatch.mock.calls[0][0].studentIds).toEqual([
      STUDENT_IDS[1],
    ]);
  });

  it('rejects an empty payload rather than silently writing nothing', async () => {
    await expect(
      service.saveDraftMarksWithinTransaction(
        [],
        { actorUserId: 5, actorLabel: 'teacher', recorder: 'teacher' },
        executor,
      ),
    ).rejects.toThrow('กรุณาส่งสถานะอย่างน้อยหนึ่งรายการ');
  });
});
