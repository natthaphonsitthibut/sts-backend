import type { QueryRunner } from 'typeorm';
import { RetireStudentObservations20260827313000 } from './migrations/20260827313000-RetireStudentObservations';

describe('RetireStudentObservations20260827313000', () => {
  const collectSql = async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new RetireStudentObservations20260827313000().up(runner);
    return statements.join('\n');
  };

  it('carries every live observation over as the teacher comment it was', async () => {
    const sql = await collectSql();
    expect(sql).toContain('INSERT INTO classroom_student_comments');
    expect(sql).toContain('cannot carry over % of % teacher observation(s)');
    expect(sql).toContain("COALESCE(category.code, 'OTHER') AS problem_category_code");
    expect(sql).toContain("COALESCE(level.code, 'NOTE') AS concern_level_code");
    expect(sql).toContain('observation.observed_at');
  });

  it('keeps an author whose account was already deleted', async () => {
    const sql = await collectSql();
    expect(sql).toContain('ADD COLUMN authored_by_display_name VARCHAR(200)');
    expect(sql).toContain('ADD CONSTRAINT chk_classroom_student_comments_author');
    expect(sql).toContain('observation.observer_display_name');
  });

  it('drops the observation subsystem after the carry-over', async () => {
    const sql = await collectSql();
    const insertAt = sql.indexOf('INSERT INTO classroom_student_comments');
    for (const table of [
      'student_observation_risk_reviews',
      'student_observation_summaries',
      'student_observation_revisions',
      'student_observations',
      'observation_behavior_tags',
      'observation_dimensions',
    ]) {
      const dropAt = sql.indexOf(`DROP TABLE IF EXISTS ${table} CASCADE`);
      expect(dropAt).toBeGreaterThan(insertAt);
    }
  });

  it('refuses to roll back instead of pretending the data is restorable', async () => {
    await expect(new RetireStudentObservations20260827313000().down()).rejects.toThrow(
      /restore a pre-migration database backup/,
    );
  });
});
