import { ExceptionAttendanceRepository } from './exception-attendance.repository';
import type {
  ExceptionAttendanceActor,
  ExceptionAttendanceSessionRow,
} from './exception-attendance.types';

const session: ExceptionAttendanceSessionRow = {
  id: '00000000-0000-4000-8000-000000000001',
  school_term_id: '1',
  school_id: 10010002,
  grade_level_id: 1,
  room_id: 1,
  classroom_id: '1',
  classroom_subject_id: '1',
  attendance_date: '2026-08-23',
  period: null,
  status: 'OPEN',
  expected_roster_count: 18,
  recorded_count: 0,
  exception_count: 0,
  submission_number: 0,
  lock_version: 1,
  record_storage_mode: 'EXCEPTIONS',
  checking_started_at: '2026-08-23T01:00:00.000Z',
  submitted_at: null,
  correction_reason: null,
  classroom_attendance_link_id: null,
};

const actor: ExceptionAttendanceActor = {
  source: 'CLASSROOM_LINK',
  schoolId: 10010002,
  classroomId: 1,
  actorUserId: null,
  teacherMembershipId: '10',
  actorLabel: 'ครูผู้เช็กชื่อ',
};

describe('ExceptionAttendanceRepository', () => {
  it('copies the session school into the frozen roster and binds the classroom scope', async () => {
    const runner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]),
    };
    const repository = new ExceptionAttendanceRepository({} as never);

    await repository.insertRosterSnapshot(session.id, 1, null, runner as never);

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[]?]>;
    const sql = calls[0][0];
    expect(sql).toContain('session_id, school_id, student_uuid');
    expect(sql).toContain('SELECT session.id, session.school_id');
    expect(sql).toContain('session.classroom_id = $2');
  });

  it('unwraps the PostgreSQL UPDATE RETURNING result tuple', async () => {
    const submitted: ExceptionAttendanceSessionRow = {
      ...session,
      status: 'SUBMITTED',
      recorded_count: 18,
      exception_count: 2,
      submitted_at: '2026-08-23T01:05:00.000Z',
    };
    const runner = {
      query: jest.fn().mockResolvedValue([[submitted], 1]),
    };
    const repository = new ExceptionAttendanceRepository({} as never);

    await expect(
      repository.finalizeSession(session, 2, 18, actor, null, runner as never),
    ).resolves.toEqual(submitted);
  });

  it('fails closed when finalization updates no session', async () => {
    const runner = {
      query: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = new ExceptionAttendanceRepository({} as never);

    await expect(
      repository.finalizeSession(session, 2, 18, actor, null, runner as never),
    ).rejects.toThrow('Attendance session finalization returned no row');
  });

  it('stores only students whose submitted attendance result changed', async () => {
    const firstStudent = '11111111-1111-4111-8111-111111111111';
    const secondStudent = '22222222-2222-4222-8222-222222222222';
    const submitted = {
      ...session,
      status: 'SUBMITTED' as const,
      submission_number: 2,
      lock_version: 3,
      submitted_at: '2026-08-23T01:10:00.000Z',
      correction_reason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
    };
    const runner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: '33333333-3333-4333-8333-333333333333' }])
        .mockResolvedValueOnce([]),
    };
    const repository = new ExceptionAttendanceRepository({} as never);

    await expect(
      repository.recordSubmissionHistory(
        {
          before: { ...session, status: 'SUBMITTED', submission_number: 1, lock_version: 2 },
          submitted,
          previous: [{ student_uuid: firstStudent, attendance_status_code: 2 }],
          requested: [
            {
              studentId: firstStudent,
              status: 'P_LATE',
              statusCode: 3,
              markedAt: '2026-08-23T01:10:00.000Z',
            },
          ],
          roster: [firstStudent, secondStudent],
          actor,
          correctionReason: 'ตรวจสอบกับครูประจำวิชาแล้ว',
        },
        runner as never,
      ),
    ).resolves.toBe(1);

    const changePayload = JSON.parse(
      String((runner.query.mock.calls[1] as unknown[])[1]?.[2]),
    ) as Array<Record<string, unknown>>;
    expect(changePayload).toEqual([
      { student_id: firstStudent, previous_status: 2, new_status: 3 },
    ]);
  });
});
