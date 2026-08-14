import type { QueryRunner } from 'typeorm';
import { SeedDemoRiskDistribution20260807160000 } from './migrations/20260807160000-SeedDemoRiskDistribution';

describe('SeedDemoRiskDistribution20260807160000', () => {
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

    await new SeedDemoRiskDistribution20260807160000()[direction](queryRunner);
    return { sql: statements.join('\n'), parameters };
  };

  it('targets only the DEMO-backed showcase school using active enrollments', async () => {
    const { sql, parameters } = await collectSql('up');

    expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
    expect(sql).toContain('GROUP BY school_id');
    expect(sql).toContain('COUNT(*)::numeric * $2::numeric / 100');
    expect(sql).toContain("calendar_day.day_type = 'SCHOOL_DAY'");
    expect(sql).toContain("existing_attendance.session_kind IN ('DAILY', 'SUBJECT')");
    expect(sql).toContain('INSERT INTO school_calendar_days');
    expect(sql).toContain('GENERATE_SERIES');
    expect(sql).toContain('idx_attendance_demo_risk_distribution_student');
    expect(sql).toContain('school.name = $2');
    expect(sql).toContain("demo_actor.data_origin_code = 'DEMO'");
    expect(parameters).toContainEqual([
      'ข้อมูลสาธิตความเสี่ยงโรงเรียน showcase',
      'โรงเรียนเทพศิรินทร์ราชดำริ',
    ]);
    expect(parameters).toContainEqual([
      'SYSTEM:DEMO_RISK_DISTRIBUTION',
      5,
      'โรงเรียนเทพศิรินทร์ราชดำริ',
    ]);
  });

  it('preserves existing high-risk students and invalidates only newly seeded profiles', async () => {
    const { sql } = await collectSql('up');

    expect(sql).toContain("profile.risk_tier = 'HIGH'");
    expect(sql).toContain("'SYSTEM:THEPSIRIN_RISK_SHOWCASE'");
    expect(sql).toContain('ON CONFLICT (student_uuid, "AttendanceDate")');
    expect(sql).toContain('SELECT DISTINCT student_uuid FROM inserted_attendance');
    expect(sql).toContain('DELETE FROM student_risk_profiles profile');
  });

  it('rolls back only distribution-marker attendance and the corresponding derived profiles', async () => {
    const { sql, parameters } = await collectSql('down');

    expect(sql).toContain('DELETE FROM attendance WHERE "RecordedBy" = $1');
    expect(sql).toContain('DELETE FROM student_risk_profiles profile');
    expect(sql).toContain('DELETE FROM school_calendar_days');
    expect(sql).toContain('AND NOT EXISTS ( SELECT 1 FROM attendance existing_attendance');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_attendance_demo_risk_distribution_student');
    expect(parameters).toContainEqual(['SYSTEM:DEMO_RISK_DISTRIBUTION']);
    expect(parameters).toContainEqual(['ข้อมูลสาธิตความเสี่ยงโรงเรียน showcase']);
  });
});
