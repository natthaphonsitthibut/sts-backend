import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { FileStorageAdapter } from '../files/storage/file-storage.types';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { MasterDataService } from '../master-data/master-data.service';
import { AttendanceOperationsService } from './attendance-operations.service';
import { ExceptionAttendanceRepository } from './exception-attendance.repository';
import { ExceptionAttendanceService } from './exception-attendance.service';
import type {
  CheckInClassroomRow,
  ExceptionAttendanceActor,
  ExceptionAttendanceSessionRow,
} from './exception-attendance.types';

describe('ExceptionAttendanceService', () => {
  const actor: ExceptionAttendanceActor = {
    source: 'CLASSROOM_LINK',
    schoolId: 1001,
    classroomId: 42,
    actorUserId: null,
    teacherMembershipId: '31',
    actorLabel: 'ครูหนึ่ง',
  };

  const classroom: CheckInClassroomRow = {
    classroom_id: '42',
    school_id: 1001,
    school_name: 'โรงเรียนหนึ่ง',
    school_status: 'ACTIVE',
    school_term_id: '21',
    academic_year: 2569,
    semester: 1,
    term_status: 'ACTIVE',
    starts_on: '2026-05-01',
    ends_on: '2026-10-31',
    grade_level_id: 4,
    grade_label: 'ม.1',
    legacy_room_number: 1,
    room_code: '1',
    room_name: null,
    classroom_status: 'ACTIVE',
  };

  const openSession: ExceptionAttendanceSessionRow = {
    id: '11111111-1111-4111-8111-111111111111',
    school_term_id: '21',
    school_id: 1001,
    grade_level_id: 4,
    room_id: 1,
    classroom_id: '42',
    classroom_subject_id: '84',
    subject_id: 1,
    attendance_date: '2026-08-21',
    period: null,
    status: 'OPEN',
    expected_roster_count: 2,
    recorded_count: 0,
    exception_count: 0,
    revision: 1,
    record_storage_mode: 'EXCEPTIONS',
    checking_started_at: '2026-08-21T01:30:00.000Z',
    submitted_at: null,
  };

  let repository: jest.Mocked<ExceptionAttendanceRepository>;
  let attendanceOperations: jest.Mocked<Pick<AttendanceOperationsService, 'assertClassroomAccess'>>;
  let audit: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;
  let riskProfiles: jest.Mocked<Pick<RiskProfileService, 'requestStudentRecalculation'>>;
  let masterData: jest.Mocked<Pick<MasterDataService, 'listActiveOptions'>>;
  let storage: jest.Mocked<Pick<FileStorageAdapter, 'resolve'>>;
  let service: ExceptionAttendanceService;

  beforeEach(() => {
    repository = {
      withTransaction: jest.fn((operation: (queryRunner: unknown) => unknown) => operation({})),
      findClassroom: jest.fn().mockResolvedValue(classroom),
      listSubjects: jest.fn().mockResolvedValue([]),
      listRoster: jest.fn().mockResolvedValue([]),
      findStudentPhotoStorageKey: jest.fn(),
      lockStartContext: jest.fn().mockResolvedValue({
        ...classroom,
        classroom_subject_id: '84',
        subject_id: 1,
        subject_code: 'HOMEROOM101',
        calendar_day_type: 'SCHOOL_DAY',
      }),
      insertTargetSession: jest.fn().mockResolvedValue(true),
      hasLegacyFullRosterSession: jest.fn().mockResolvedValue(false),
      findTargetSessionForUpdate: jest
        .fn()
        .mockResolvedValue({ ...openSession, expected_roster_count: 0 }),
      insertRosterSnapshot: jest.fn().mockResolvedValue(2),
      updateExpectedRosterCount: jest.fn().mockResolvedValue(undefined),
      findSessionById: jest.fn().mockResolvedValue(openSession),
      findSessionForUpdate: jest.fn().mockResolvedValue(openSession),
      listSessionRoster: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValue(['student-1', 'student-2']),
      listStoredExceptions: jest.fn().mockResolvedValue([]),
      replaceExceptions: jest.fn().mockResolvedValue(undefined),
      finalizeSession: jest.fn().mockResolvedValue({
        ...openSession,
        status: 'SUBMITTED',
        recorded_count: 2,
        exception_count: 1,
        submitted_at: '2026-08-21T02:00:00.000Z',
      }),
    } as unknown as jest.Mocked<ExceptionAttendanceRepository>;
    audit = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    riskProfiles = { requestStudentRecalculation: jest.fn().mockResolvedValue(undefined) };
    masterData = {
      listActiveOptions: jest.fn().mockResolvedValue([
        {
          code: 'UNKNOWN',
          labelTh: 'ยังไม่ทราบสาเหตุ',
          categoryCode: null,
          requiresDetail: null,
        },
        {
          code: 'MINOR_ILLNESS',
          labelTh: 'เจ็บป่วยเล็กน้อย',
          categoryCode: 'HEALTH',
          requiresDetail: null,
        },
      ]),
    };
    attendanceOperations = {
      assertClassroomAccess: jest.fn().mockResolvedValue({ schoolId: 1001 }),
    };
    storage = { resolve: jest.fn() };
    service = new ExceptionAttendanceService(
      repository,
      attendanceOperations as AttendanceOperationsService,
      audit as AuditLogService,
      riskProfiles as RiskProfileService,
      masterData as MasterDataService,
      storage as FileStorageAdapter,
    );
  });

  it('keeps internal user identity separate from external teacher membership identity', async () => {
    const result = await service.resolveInternalActor(42, {
      id: 7,
      username: 'school-admin',
      FirstName: 'ผู้ดูแล',
      LastName: 'โรงเรียน',
    } as never);

    expect(attendanceOperations.assertClassroomAccess.mock.calls).toContainEqual([
      42,
      expect.objectContaining({ id: 7 }),
    ]);
    expect(result).toMatchObject({
      source: 'INTERNAL',
      schoolId: 1001,
      classroomId: 42,
      actorUserId: 7,
      teacherMembershipId: null,
      actorLabel: 'ผู้ดูแล โรงเรียน',
    });
  });

  it('blocks student photos when the classroom context is not operational', async () => {
    repository.findClassroom.mockResolvedValueOnce({
      ...classroom,
      classroom_status: 'INACTIVE',
    });

    await expect(service.resolveStudentPhoto(actor, 'student-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.findStudentPhotoStorageKey.mock.calls).toHaveLength(0);
    expect(storage.resolve).not.toHaveBeenCalled();
  });

  it('starts once, freezes the roster, and keeps OPEN missing marks non-present', async () => {
    const result = await service.start(actor, {
      date: '2026-08-21',
      classroomSubjectId: 84,
    });

    expect(repository.insertTargetSession.mock.calls).toHaveLength(1);
    expect(repository.insertRosterSnapshot.mock.calls).toContainEqual([
      openSession.id,
      42,
      null,
      expect.anything(),
    ]);
    expect(repository.updateExpectedRosterCount.mock.calls).toContainEqual([
      openSession.id,
      2,
      null,
      expect.anything(),
    ]);
    expect(result.data).toMatchObject({
      status: 'OPEN',
      readOnly: false,
      expectedRosterCount: 2,
      exceptions: [],
    });
  });

  it('rejects an exception-only session when legacy full-roster data already exists', async () => {
    repository.hasLegacyFullRosterSession.mockResolvedValue(true);

    await expect(
      service.start(actor, { date: '2026-08-21', classroomSubjectId: 84 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.insertTargetSession.mock.calls).toHaveLength(0);
    expect(repository.insertRosterSnapshot.mock.calls).toHaveLength(0);
  });

  it('submits only exceptions in one transaction and recalculates the frozen roster', async () => {
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);

    const result = await service.submit(actor, openSession.id, {
      exceptions: [{ studentId: 'student-1', status: 'P_ABSENT' }],
    });

    expect(repository.replaceExceptions.mock.calls).toContainEqual([
      openSession.id,
      [expect.objectContaining({ studentId: 'student-1', statusCode: 2 })],
      actor,
      expect.anything(),
    ]);
    expect(repository.finalizeSession.mock.calls).toContainEqual([
      openSession,
      1,
      2,
      actor,
      expect.anything(),
    ]);
    expect(audit.recordAtomic.mock.calls).toContainEqual([
      expect.objectContaining({ action: 'ATTENDANCE_SUBMIT' }),
      expect.anything(),
    ]);
    expect(riskProfiles.requestStudentRecalculation.mock.calls).toContainEqual([
      ['student-1', 'student-2'],
      'exception-attendance-submit',
    ]);
    expect(result.data).toMatchObject({ status: 'SUBMITTED', exceptionCount: 1 });
    expect(repository.replaceExceptions.mock.calls[0]?.[1][0]).toMatchObject({
      absenceReasonCode: 'UNKNOWN',
    });
  });

  it('returns an identical duplicate submit without writing or auditing again', async () => {
    repository.findSessionForUpdate.mockResolvedValue({
      ...openSession,
      status: 'SUBMITTED',
      submitted_at: '2026-08-21T02:00:00.000Z',
      exception_count: 1,
      recorded_count: 2,
    });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2, absence_reason_code: 'UNKNOWN' },
    ]);

    const result = await service.submit(actor, openSession.id, {
      exceptions: [{ studentId: 'student-1', status: 'P_ABSENT' }],
    });

    expect(result.data.idempotent).toBe(true);
    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
    expect(audit.recordAtomic.mock.calls).toHaveLength(0);
    expect(riskProfiles.requestStudentRecalculation.mock.calls).toHaveLength(0);
  });

  it('rejects a changed duplicate submit', async () => {
    repository.findSessionForUpdate.mockResolvedValue({ ...openSession, status: 'SUBMITTED' });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2, absence_reason_code: 'UNKNOWN' },
    ]);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [{ studentId: 'student-1', status: 'P_LATE' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an exception outside the frozen roster before any write', async () => {
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [{ studentId: 'student-3', status: 'P_LEAVE' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
    expect(audit.recordAtomic.mock.calls).toHaveLength(0);
  });

  it('stores an explicit absence reason and rejects it for late or leave', async () => {
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);

    await service.submit(actor, openSession.id, {
      exceptions: [
        {
          studentId: 'student-1',
          status: 'P_ABSENT',
          absenceReasonCode: 'MINOR_ILLNESS',
        },
      ],
    });
    expect(repository.replaceExceptions.mock.calls[0]?.[1][0]).toMatchObject({
      statusCode: 2,
      absenceReasonCode: 'MINOR_ILLNESS',
    });

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [
          {
            studentId: 'student-1',
            status: 'P_LATE',
            absenceReasonCode: 'MINOR_ILLNESS',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown or inactive absence reason before writing', async () => {
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [
          {
            studentId: 'student-1',
            status: 'P_ABSENT',
            absenceReasonCode: 'DISABLED_REASON',
          },
        ],
      }),
    ).rejects.toThrow('สาเหตุการขาดไม่ถูกต้องหรือถูกปิดใช้งาน');

    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
  });

  it('keeps a submitted retry idempotent after its reason is deactivated', async () => {
    repository.findSessionForUpdate.mockResolvedValue({ ...openSession, status: 'SUBMITTED' });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      {
        student_uuid: 'student-1',
        attendance_status_code: 2,
        absence_reason_code: 'MINOR_ILLNESS',
      },
    ]);
    masterData.listActiveOptions.mockResolvedValue([]);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [
          {
            studentId: 'student-1',
            status: 'P_ABSENT',
            absenceReasonCode: 'MINOR_ILLNESS',
          },
        ],
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));

    expect(masterData.listActiveOptions.mock.calls).toHaveLength(0);
    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
  });
});
