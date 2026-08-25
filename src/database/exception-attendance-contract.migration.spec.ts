import type { QueryRunner } from 'typeorm';
import { AddExceptionAttendanceContract20260827240000 } from './migrations/20260827240000-AddExceptionAttendanceContract';

describe('AddExceptionAttendanceContract20260827240000', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        const normalized = statement.replace(/\s+/g, ' ').trim();
        statements.push(normalized);
        if (normalized.includes('mapped_slot_count')) {
          return Promise.resolve([
            {
              session_count: 0,
              mapped_slot_count: 0,
              mapped_offering_count: 0,
              identity_mismatch_count: 0,
            },
          ]);
        }
        if (normalized.includes('invalid_session_count')) {
          return Promise.resolve([
            {
              invalid_session_count: 0,
              source_exception_count: 0,
              target_exception_count: 0,
              roster_count_mismatch: 0,
              roster_scope_mismatch_count: 0,
              exception_school_mismatch_count: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddExceptionAttendanceContract20260827240000()[direction](runner);
    return statements.join('\n');
  };

  it('adds target identity, frozen roster, and exception-only rows with real FKs', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ADD COLUMN classroom_subject_id BIGINT');
    expect(sql).toContain("record_storage_mode IN ('FULL_ROSTER', 'EXCEPTIONS')");
    expect(sql).toContain('CREATE TABLE attendance_session_roster');
    expect(sql).toContain('CREATE TABLE attendance_exceptions');
    expect(sql).toContain('GROUP BY mark.session_id, session.school_id, mark.student_uuid');
    expect(sql).toContain(
      'FOREIGN KEY (session_id, student_uuid) REFERENCES attendance_session_roster(session_id, student_uuid) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain('CHECK (attendance_status_code IN (2, 3, 4))');
    expect(sql).toContain('ALTER COLUMN period DROP NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX uq_attendance_sessions_full_roster_session');
    expect(sql).toContain('CREATE UNIQUE INDEX uq_attendance_sessions_exception_session');
    expect(sql).toContain('CREATE VIEW attendance_subject_day WITH (security_invoker = true) AS');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE attendance_day, attendance_subject_day');
    expect(sql).toContain(
      "record_storage_mode = 'EXCEPTIONS' AND timetable_slot_id IS NULL AND period IS NULL",
    );
  });

  it('preserves logical present rows through the submitted roster snapshot', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain(
      'JOIN attendance_session_roster roster ON roster.session_id = session.id',
    );
    expect(sql).toContain('COALESCE(exception.attendance_status_code, 1)::smallint');
    expect(sql).toContain("session.status IN ('SUBMITTED', 'REOPENED')");
    expect(sql).toContain('roster.roster_count <> session.expected_roster_count');
  });

  it('fails closed when target-only sessions exist and restores the legacy view', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain("record_storage_mode = 'EXCEPTIONS'");
    expect(sql).toContain('Refusing rollback: exception-only attendance sessions');
    expect(sql).toContain('attendance_session_roster no longer matches its historical source');
    expect(sql).toContain('ALTER COLUMN period SET NOT NULL');
    expect(sql).toContain('CREATE VIEW attendance_day WITH (security_invoker = true) AS');
    expect(sql).toContain('FROM attendance period');
  });
});
