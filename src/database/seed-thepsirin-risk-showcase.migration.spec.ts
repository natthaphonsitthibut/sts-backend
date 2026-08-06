import type { QueryRunner } from 'typeorm';
import { SeedThepsirinRiskShowcase20260807150000 } from './migrations/20260807150000-SeedThepsirinRiskShowcase';

describe('SeedThepsirinRiskShowcase20260807150000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const parameters: unknown[][] = [];
    const queryRunner = {
      query: jest.fn((statement: string, params?: unknown[]) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        parameters.push(params ?? []);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new SeedThepsirinRiskShowcase20260807150000()[direction](queryRunner);
    return { sql: statements.join('\n'), parameters };
  };

  it('seeds complete threshold-sized absences on unused real school days', async () => {
    const { sql, parameters } = await collectSql('up');

    expect(sql).toContain("setting_key = 'CASE_RISK_HIGH_ABSENCE_DAYS'");
    expect(sql).toContain("calendar_day.day_type = 'SCHOOL_DAY'");
    expect(sql).toContain("existing_attendance.session_kind IN ('DAILY', 'SUBJECT')");
    expect(sql).toContain('WHERE available_day_count = absence_threshold');
    expect(sql).toContain("'DAILY', 2, now(), $3");
    expect(parameters.flat()).toContain('SYSTEM:THEPSIRIN_RISK_SHOWCASE');
  });

  it('invalidates only profiles backed by a complete demo absence set', async () => {
    const { sql } = await collectSql('up');

    expect(sql).toContain('HAVING COUNT(DISTINCT attendance_record."AttendanceDate")');
    expect(sql).toContain('DELETE FROM student_risk_profiles profile');
    expect(sql).toContain('profile.student_uuid = student.student_uuid');
  });

  it('removes only its marker attendance and invalidates the same profiles on rollback', async () => {
    const { sql, parameters } = await collectSql('down');

    expect(sql).toContain('WITH affected_students AS MATERIALIZED');
    expect(sql).toContain('DELETE FROM attendance WHERE "RecordedBy" = $1');
    expect(sql).toContain('DELETE FROM student_risk_profiles profile');
    expect(parameters.flat()).toEqual(['SYSTEM:THEPSIRIN_RISK_SHOWCASE']);
  });
});
