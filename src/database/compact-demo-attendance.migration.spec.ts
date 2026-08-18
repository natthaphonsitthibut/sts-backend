import type { QueryRunner } from 'typeorm';
import { CompactDemoSubjectAttendance20260826090000 } from './migrations/20260826090000-CompactDemoSubjectAttendance';
import { RetireLeakedAutomatedTestAccounts20260826091000 } from './migrations/20260826091000-RetireLeakedAutomatedTestAccounts';
import { RetireDailyAttendance20260826092000 } from './migrations/20260826092000-RetireDailyAttendance';

function normalized(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim();
}

describe('compact demo attendance migrations', () => {
  it('replaces demo attendance with 3-5 timetable-backed SUBJECT days', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        const sql = normalized(statement);
        statements.push(sql);
        if (sql.includes('SELECT id FROM schools')) return Promise.resolve([{ id: 10010004 }]);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new CompactDemoSubjectAttendance20260826090000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain('WHERE id BETWEEN 10010001 AND 10010010');
    expect(sql).toContain('WHEN school.id = $1 THEN 5');
    expect(sql).toContain('ELSE (3 + MOD(school.id, 3))::smallint');
    expect(sql).toContain("session.session_kind = 'SUBJECT'");
    expect(sql).toContain("record.session_kind = 'SUBJECT'");
    expect(sql.indexOf('WHERE NOT EXISTS ( SELECT 1 FROM timetable_slot_teachers')).toBeLessThan(
      sql.indexOf('TRUNCATE TABLE'),
    );
    expect(sql).toContain('FROM timetable_slot_teachers slot_teacher');
    expect(sql).toContain("teacher.teacher_status = 'ACTIVE'");
    expect(sql).toContain('recorder.teacher_id AS recorded_by_teacher_id');
    expect(sql).toContain("'SUBJECT', 'SUBMITTED'");
    expect(sql).toContain('PARTITION BY enrollment."SchoolID_Onec", enrollment.classroom_id');
    expect(sql).toContain('GREATEST(1, CEIL(student.classroom_student_count::numeric * 0.20))');
    expect(sql).toContain('seed.day_rank <= 3 THEN 2');
    expect(sql).not.toMatch(/INSERT INTO attendance[\s\S]*?'DAILY'/);
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)[\s\S]{0,80}\bcases\b/i);
  });

  it('keeps destructive attendance compaction non-reversible', async () => {
    const query = jest.fn();
    await new CompactDemoSubjectAttendance20260826090000().down({
      query,
    } as unknown as QueryRunner);
    expect(query).not.toHaveBeenCalled();
  });

  it('deletes unreferenced smoke accounts while retaining immutable history rows', async () => {
    const statements: string[] = [];
    let candidateRead = false;
    const queryRunner = {
      query: jest.fn((statement: string) => {
        const sql = normalized(statement);
        statements.push(sql);
        if (sql.startsWith('SELECT id, username FROM users')) {
          candidateRead = true;
          return Promise.resolve([{ id: 77, username: 'smoke-student' }]);
        }
        if (candidateRead && sql.includes('FROM pg_constraint')) return Promise.resolve([]);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new RetireLeakedAutomatedTestAccounts20260826091000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain("status = 'DISABLED'");
    expect(sql).toContain("password = 'NOT_A_LOGIN_CREDENTIAL'");
    expect(sql).toContain("data_origin_code = 'AUTOMATED_TEST'");
    expect(sql).toContain('ALTER TABLE audit_log DISABLE TRIGGER trg_audit_log_immutable');
    expect(sql).toContain('DELETE FROM users WHERE id = ANY($1::int[])');
    expect(sql).not.toContain('DELETE FROM "audit_log"');
    expect(sql).toContain('ALTER TABLE audit_log ENABLE TRIGGER trg_audit_log_immutable');
  });

  it('keeps but disables a smoke account that operational data still references', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        const sql = normalized(statement);
        statements.push(sql);
        if (sql.startsWith('SELECT id, username FROM users')) {
          return Promise.resolve([{ id: 88, username: 'smoke-student' }]);
        }
        if (sql.includes('FROM pg_constraint')) {
          return Promise.resolve([{ table_name: 'cases', column_name: 'created_by' }]);
        }
        if (sql.includes('FROM "cases"')) return Promise.resolve([{ referenced_id: '88' }]);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new RetireLeakedAutomatedTestAccounts20260826091000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain("status = 'DISABLED'");
    expect(sql).not.toContain('DELETE FROM users WHERE id = ANY($1::int[])');
  });

  it('retires DAILY constraints and keeps the day view subject-derived', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(normalized(statement));
        return Promise.resolve([{ count: 0 }]);
      }),
    } as unknown as QueryRunner;

    await new RetireDailyAttendance20260826092000().up(queryRunner);
    const sql = statements.join('\n');

    expect(sql).toContain(
      "DELETE FROM teacher_access_grant_capabilities WHERE capability = 'HOMEROOM_ATTENDANCE'",
    );
    expect(sql).toContain("assignment.assignment_kind = 'HOMEROOM'");
    expect(sql).toContain('DROP INDEX IF EXISTS uq_attendance_daily');
    expect(sql).toContain("CHECK (session_kind = 'SUBJECT')");
    expect(sql).toContain('CHECK (subject_id IS NOT NULL AND timetable_slot_id IS NOT NULL)');
    expect(sql).toContain("WHERE period.session_kind = 'SUBJECT'");
    expect(sql).not.toContain('FROM attendance legacy');

    statements.length = 0;
    await new RetireDailyAttendance20260826092000().down(queryRunner);
    const rollbackSql = statements.join('\n');
    expect(rollbackSql).toContain("WHERE legacy.session_kind = 'DAILY'");
  });
});
