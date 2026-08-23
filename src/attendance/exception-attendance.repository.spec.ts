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
  subject_id: 1,
  attendance_date: '2026-08-23',
  period: null,
  status: 'OPEN',
  expected_roster_count: 18,
  recorded_count: 0,
  exception_count: 0,
  revision: 1,
  record_storage_mode: 'EXCEPTIONS',
  checking_started_at: '2026-08-23T01:00:00.000Z',
  submitted_at: null,
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
      repository.finalizeSession(session, 2, 18, actor, runner as never),
    ).resolves.toEqual(submitted);
  });

  it('fails closed when finalization updates no session', async () => {
    const runner = {
      query: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = new ExceptionAttendanceRepository({} as never);

    await expect(
      repository.finalizeSession(session, 2, 18, actor, runner as never),
    ).rejects.toThrow('Attendance session finalization returned no row');
  });
});
