import { AddStudentObservationSummaries20260714270000 } from '../database/migrations/20260714270000-AddStudentObservationSummaries';

describe('AddStudentObservationSummaries20260714270000', () => {
  it('creates scoped citations, review metadata, fingerprint, and stale trigger', async () => {
    const sql: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve([]);
      }),
    };
    await new AddStudentObservationSummaries20260714270000().up(runner as never);
    const combined = sql.join('\n');
    expect(combined).toContain('student_observation_summaries');
    expect(combined).toContain('input_fingerprint');
    expect(combined).toContain('student_observation_summary_sources');
    expect(combined).toContain(
      'REFERENCES student_observation_revisions(observation_id, revision_number)',
    );
    expect(combined).toContain('mark_student_observation_summaries_stale');
    expect(combined).not.toContain('risk_profiles');
    expect(combined).not.toContain('INSERT INTO cases');
  });

  it('drops trigger and function before summary tables', async () => {
    const sql: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve([]);
      }),
    };
    await new AddStudentObservationSummaries20260714270000().down(runner as never);
    expect(sql.join('\n')).toContain(
      'DROP TRIGGER IF EXISTS trg_student_observation_summary_stale',
    );
  });
});
