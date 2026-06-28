import { ConflictException } from '@nestjs/common';
import { getBangkokDateString } from '../common/utils/date.util';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import type { AttendanceSessionRow } from './attendance-operations.types';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceWriteService } from './attendance-write.service';

const STUDENT_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
];
const TEST_ATTENDANCE_DATE = getBangkokDateString();

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
      'filterStudentIdsInScope' | 'upsertAttendanceBatch' | 'listAttendanceStatuses'
    >
  >;
  let operationsRepository: jest.Mocked<
    Pick<
      AttendanceOperationsRepository,
      | 'findClassMetadata'
      | 'listRosterIds'
      | 'findOrCreateTermForClass'
      | 'findOrCreateSessionForUpdate'
      | 'updateSessionSubmitted'
      | 'recordSessionAudit'
    >
  >;
  let service: AttendanceWriteService;

  beforeEach(() => {
    attendanceRepository = {
      filterStudentIdsInScope: jest.fn().mockResolvedValue(STUDENT_IDS),
      upsertAttendanceBatch: jest.fn().mockResolvedValue(undefined),
      listAttendanceStatuses: jest.fn().mockResolvedValue([]),
    };
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
    };
    service = new AttendanceWriteService(
      attendanceRepository as unknown as AttendanceRepository,
      operationsRepository as unknown as AttendanceOperationsRepository,
      { checkConsecutiveAbsences: jest.fn() } as never,
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
    });
    expect(attendanceRepository.upsertAttendanceBatch).toHaveBeenCalledTimes(1);
    expect(operationsRepository.updateSessionSubmitted).toHaveBeenCalledTimes(1);
    expect(operationsRepository.recordSessionAudit).toHaveBeenCalledTimes(1);
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
});
