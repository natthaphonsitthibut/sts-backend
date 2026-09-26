import { DeleteSmokeStudentFixture20260926120000 } from './migrations/20260926120000-DeleteSmokeStudentFixture';

describe('DeleteSmokeStudentFixture migration', () => {
  it('only targets SMOKE- identifiers and removes dependants before the student', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn((sql: string) => (queries.push(sql), Promise.resolve())) };

    await new DeleteSmokeStudentFixture20260926120000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain(`"PersonID_Onec" LIKE 'SMOKE-%'`);
    expect(sql.indexOf('DELETE FROM student_risk_profiles')).toBeLessThan(
      sql.indexOf('DELETE FROM student_term '),
    );
    expect(sql.indexOf('DELETE FROM student_term ')).toBeLessThan(
      sql.indexOf('DELETE FROM student_person '),
    );
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM student_term t WHERE t.person_uuid = s.person_uuid)',
    );
  });

  it('is explicitly irreversible', async () => {
    await expect(new DeleteSmokeStudentFixture20260926120000().down()).rejects.toThrow(
      'intentionally irreversible',
    );
  });
});
