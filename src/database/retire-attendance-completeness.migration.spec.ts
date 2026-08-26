import { RetireAttendanceCompleteness20260827320000 } from './migrations/20260827320000-RetireAttendanceCompleteness';

describe('RetireAttendanceCompleteness migration', () => {
  it('hard-deletes calendar, permission and obsolete completeness contracts', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const migration = new RetireAttendanceCompleteness20260827320000();

    await migration.up({
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve([]);
      }),
    } as never);

    const sql = queries.map((entry) => entry.sql).join('\n');
    expect(sql).toContain("permission <> 'attendance-dashboard'");
    expect(sql).toContain("domain_code IN ('ATTENDANCE_RECONCILIATION', 'ATTENDANCE_ANOMALY')");
    expect(sql).toContain('RENAME COLUMN school_day_count TO recorded_day_count');
    expect(sql).toContain('RENAME COLUMN weighted_attendance_percent TO attendance_rate_percent');
    expect(sql).toContain('DROP COLUMN IF EXISTS weighted_absence_days');
    expect(sql).toContain('DROP COLUMN IF EXISTS anomaly_notified_at');
    expect(sql).toContain('DROP TABLE IF EXISTS school_calendar_days');
    expect(sql).toContain('DROP TABLE IF EXISTS school_calendar_day_types');
    expect(queries).toContainEqual({
      sql: 'DELETE FROM notifications WHERE type_code = $1',
      params: ['ATTENDANCE_INCOMPLETE'],
    });
  });

  it('requires backup restore instead of a fake empty-schema rollback', async () => {
    const migration = new RetireAttendanceCompleteness20260827320000();
    await expect(migration.down()).rejects.toThrow('irreversible');
  });
});
