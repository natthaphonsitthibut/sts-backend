import { RemoveUnverifiableAttendanceHistory20260827313200 } from './migrations/20260827313200-RemoveUnverifiableAttendanceHistory';

describe('RemoveUnverifiableAttendanceHistory migration', () => {
  it('hard-deletes only submitted history with no actor provenance', async () => {
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
    expect(sql).toContain('record."RecordedBy" IS DISTINCT FROM \'classroom-check-in\'');
    expect(sql).toContain('DELETE FROM attendance_sessions session');
    expect(sql).not.toContain('UPDATE attendance_sessions');
  });

  it('requires backup restore for rollback', async () => {
    const migration = new RemoveUnverifiableAttendanceHistory20260827313200();
    await expect(migration.down()).rejects.toThrow('pre-migration backup');
  });
});
