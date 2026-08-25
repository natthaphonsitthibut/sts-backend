import { RemoveUnverifiableAttendanceHistory20260827313200 } from './migrations/20260827313200-RemoveUnverifiableAttendanceHistory';

describe('RemoveUnverifiableAttendanceHistory migration', () => {
  it('fails closed without deleting submitted history that lacks actor provenance', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new RemoveUnverifiableAttendanceHistory20260827313200().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('unverifiable_attendance_sessions_20260827');
    expect(sql).toContain('session.submitted_by IS NULL');
    expect(sql).toContain('session.submitted_by_teacher_membership_id IS NULL');
    expect(sql).toContain('exception.marked_by_teacher_membership_id IS NOT NULL');
    expect(sql).toContain('unverifiable_session_count');
    expect(sql).toContain('history was preserved and migration stopped');
    expect(sql).not.toContain('DELETE FROM attendance_sessions session');
    expect(sql).not.toContain('DELETE FROM attendance_session_roster roster');
    expect(sql).not.toContain('DELETE FROM attendance_exceptions exception');
    expect(sql).not.toContain('DELETE FROM student_risk_profiles profile');
    expect(sql).not.toContain('UPDATE attendance_sessions');
  });

  it('has a no-op rollback because the migration is validation-only', async () => {
    const migration = new RemoveUnverifiableAttendanceHistory20260827313200();
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
