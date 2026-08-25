import { DropLegacyAttendanceContracts20260827310000 } from './migrations/20260827310000-DropLegacyAttendanceContracts';

describe('DropLegacyAttendanceContracts migration', () => {
  it('guards replacement coverage and preserves logical attendance before dropping legacy data', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new DropLegacyAttendanceContracts20260827310000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('missing_homerooms');
    expect(sql).toContain('missing_offerings');
    expect(sql).toContain('live_provenance');
    expect(sql).toContain('legacy_welfare');
    expect(sql).toContain('CREATE TEMP TABLE legacy_attendance_logical');
    expect(sql).toContain('logical_rows <> roster_rows');
    expect(sql).toContain('logical_exceptions <> stored_exceptions');
    expect(sql).toContain('status_mismatches <> 0');
    expect(sql.indexOf('CREATE TEMP TABLE legacy_attendance_logical')).toBeLessThan(
      sql.indexOf('DROP TABLE attendance'),
    );
    expect(
      sql.indexOf("DELETE FROM attendance_sessions WHERE record_storage_mode = 'FULL_ROSTER'"),
    ).toBeGreaterThan(sql.indexOf('DROP TABLE attendance'));
    expect(sql.indexOf('DROP COLUMN source_assignment_id')).toBeLessThan(
      sql.indexOf('DROP TABLE classroom_teacher_assignments'),
    );
    expect(sql.indexOf('DROP COLUMN timetable_slot_id')).toBeLessThan(
      sql.lastIndexOf('DROP TABLE timetable_slots'),
    );
    expect(sql).toContain('DROP TABLE school_period_times');
  });

  it('rebuilds reads from roster and exceptions and has an explicit restore-only down guard', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };
    const migration = new DropLegacyAttendanceContracts20260827310000();

    await migration.up(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('CREATE VIEW attendance_effective_records');
    expect(sql).toContain('JOIN attendance_session_roster roster');
    expect(sql).toContain('LEFT JOIN attendance_exceptions exception');
    expect(sql).toContain('CREATE VIEW attendance_day');
    expect(sql).toContain('CREATE VIEW attendance_subject_day');
    expect(sql).not.toContain('CREATE TABLE legacy_');
    await expect(migration.down()).rejects.toThrow('pre-deploy pg_dump');
  });
});
