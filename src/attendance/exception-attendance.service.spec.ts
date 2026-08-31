import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { FileStorageAdapter } from '../files/storage/file-storage.types';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
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
    attendance_date: '2026-08-21',
    period: null,
    status: 'OPEN',
    expected_roster_count: 2,
    recorded_count: 0,
    exception_count: 0,
    submission_number: 0,
    lock_version: 1,
    record_storage_mode: 'EXCEPTIONS',
    checking_started_at: '2026-08-21T01:30:00.000Z',
    submitted_at: null,
    correction_reason: null,
    classroom_attendance_link_id: '22222222-2222-4222-8222-222222222222',
  };

  let repository: jest.Mocked<ExceptionAttendanceRepository>;
  let attendanceOperations: jest.Mocked<Pick<AttendanceOperationsService, 'assertClassroomAccess'>>;
  let audit: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;
  let riskProfiles: jest.Mocked<Pick<RiskProfileService, 'requestStudentRecalculation'>>;
  let storage: jest.Mocked<Pick<FileStorageAdapter, 'resolve'>>;
  let service: ExceptionAttendanceService;

  beforeEach(() => {
    repository = {
      withTransaction: jest.fn((operation: (queryRunner: unknown) => unknown) => operation({})),
      findClassroom: jest.fn().mockResolvedValue(classroom),
      listSubjects: jest.fn().mockResolvedValue([]),
      listRoster: jest.fn().mockResolvedValue([]),
      findRosterSessionId: jest.fn().mockResolvedValue(null),
      listSessionExceptions: jest.fn().mockResolvedValue([]),
      listRosterSnapshot: jest.fn().mockResolvedValue([]),
      findStudentPhotoStorageKey: jest.fn(),
      lockStartContext: jest.fn().mockResolvedValue({
        ...classroom,
        classroom_subject_id: '84',
        subject_id: 1,
        subject_code: 'HOMEROOM101',
      }),
      insertTargetSession: jest.fn().mockResolvedValue(true),
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
      recordSubmissionHistory: jest.fn().mockResolvedValue(1),
      finalizeSession: jest.fn().mockResolvedValue({
        ...openSession,
        status: 'SUBMITTED',
        recorded_count: 2,
        exception_count: 1,
        submitted_at: '2026-08-21T02:00:00.000Z',
        submission_number: 1,
        lock_version: 2,
      }),
    } as unknown as jest.Mocked<ExceptionAttendanceRepository>;
    audit = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    riskProfiles = { requestStudentRecalculation: jest.fn().mockResolvedValue(undefined) };
    attendanceOperations = {
      assertClassroomAccess: jest.fn().mockResolvedValue({ schoolId: 1001 }),
    };
    storage = { resolve: jest.fn() };
    service = new ExceptionAttendanceService(
      repository,
      attendanceOperations as AttendanceOperationsService,
      audit as AuditLogService,
      riskProfiles as RiskProfileService,
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

  it('uses the frozen roster and redacts welfare fields for an assignment link', async () => {
    repository.findRosterSessionId.mockResolvedValue(openSession.id);
    repository.listRosterSnapshot.mockResolvedValue([
      {
        student_uuid: 'student-1',
        student_number: '1',
        first_name: 'เด็กหญิงหนึ่ง',
        last_name: 'ทดสอบ',
        has_photo: true,
        photo_updated_at: '2026-08-21T00:00:00.000Z',
        risk_tier: 'CRITICAL',
        teacher_comment: 'ข้อมูลติดตามที่ไม่ควรออกทางลิงก์มอบหมาย',
      },
    ]);

    const result = await service.getRoster(
      { ...actor, studentDataAccess: 'ATTENDANCE_ONLY', allowedClassroomSubjectIds: [84] },
      { date: '2026-08-21', classroomSubjectId: 84 },
    );

    expect(repository.listRosterSnapshot.mock.calls).toContainEqual([openSession.id]);
    expect(repository.listRoster.mock.calls).toHaveLength(0);
    expect(result.data[0]).toMatchObject({ riskTier: null, teacherComment: null });
  });

  it('reports no register for a lesson nobody has started, without starting one', async () => {
    repository.findRosterSessionId.mockResolvedValue(null);

    await expect(
      service.findLessonSession(actor, { date: '2026-08-21', classroomSubjectId: 84 }),
    ).resolves.toEqual({ success: true, data: null });
    // Looking at a lesson must not freeze a roster or leave a session behind.
    expect(repository.insertTargetSession.mock.calls).toHaveLength(0);
    expect(repository.insertRosterSnapshot.mock.calls).toHaveLength(0);
  });

  it('returns the submitted register so a lesson opens on its recorded marks', async () => {
    repository.findRosterSessionId.mockResolvedValue(openSession.id);
    repository.findSessionById.mockResolvedValue({
      ...openSession,
      status: 'SUBMITTED',
      submission_number: 1,
      lock_version: 2,
      submitted_at: '2026-08-21T02:00:00.000Z',
    });
    repository.listSessionExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2 },
    ]);

    await expect(
      service.findLessonSession(actor, { date: '2026-08-21', classroomSubjectId: 84 }),
    ).resolves.toMatchObject({
      data: {
        hasSubmittedResult: true,
        lockVersion: 2,
        exceptions: [{ studentId: 'student-1', status: 'P_ABSENT' }],
      },
    });
    expect(repository.insertTargetSession.mock.calls).toHaveLength(0);
  });

  it('refuses to read a lesson outside the subjects an assignment link covers', async () => {
    await expect(
      service.findLessonSession(
        { ...actor, allowedClassroomSubjectIds: [84] },
        { date: '2026-08-21', classroomSubjectId: 99 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findRosterSessionId.mock.calls).toHaveLength(0);
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
      null,
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
    expect(repository.replaceExceptions.mock.calls[0]?.[1][0]).not.toHaveProperty(
      'absenceReasonCode',
    );
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
      { student_uuid: 'student-1', attendance_status_code: 2 },
    ]);

    const result = await service.submit(actor, openSession.id, {
      exceptions: [{ studentId: 'student-1', status: 'P_ABSENT' }],
    });

    expect(result.data.idempotent).toBe(true);
    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
    expect(audit.recordAtomic.mock.calls).toHaveLength(0);
    expect(riskProfiles.requestStudentRecalculation.mock.calls).toHaveLength(0);
  });

  it('replaces a submitted result when a reason and current lock are provided', async () => {
    const submittedSession = {
      ...openSession,
      status: 'SUBMITTED' as const,
      submission_number: 1,
      lock_version: 2,
      submitted_at: '2026-08-21T02:00:00.000Z',
    };
    repository.findSessionForUpdate.mockResolvedValue(submittedSession);
    repository.finalizeSession.mockResolvedValue({
      ...submittedSession,
      submission_number: 2,
      lock_version: 3,
      correction_reason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
    });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2 },
    ]);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [{ studentId: 'student-1', status: 'P_LATE' }],
        correctionReason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
        expectedLockVersion: 2,
      }),
    ).resolves.toMatchObject({ data: { submissionNumber: 2, lockVersion: 3 } });
    expect(repository.recordSubmissionHistory.mock.calls[0]?.[0]).toMatchObject({
      correctionReason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
      before: submittedSession,
    });
  });

  it('rejects a changed submitted result without a correction reason', async () => {
    repository.findSessionForUpdate.mockResolvedValue({
      ...openSession,
      status: 'SUBMITTED',
      submission_number: 1,
      lock_version: 2,
    });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2 },
    ]);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [{ studentId: 'student-1', status: 'P_LATE' }],
        expectedLockVersion: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a stale correction before replacing stored results', async () => {
    repository.findSessionForUpdate.mockResolvedValue({
      ...openSession,
      status: 'SUBMITTED',
      submission_number: 2,
      lock_version: 3,
    });
    repository.listSessionRoster.mockReset().mockResolvedValue(['student-1', 'student-2']);
    repository.listStoredExceptions.mockResolvedValue([
      { student_uuid: 'student-1', attendance_status_code: 2 },
    ]);

    await expect(
      service.submit(actor, openSession.id, {
        exceptions: [{ studentId: 'student-1', status: 'P_LATE' }],
        correctionReason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
        expectedLockVersion: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.replaceExceptions.mock.calls).toHaveLength(0);
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
});
