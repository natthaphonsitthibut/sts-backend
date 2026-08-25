import type { QueryRunner } from 'typeorm';
import { AddProblemCategoryFallbackFlag20260827312400 } from './migrations/20260827312400-AddProblemCategoryFallbackFlag';

describe('AddProblemCategoryFallbackFlag20260827312400', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddProblemCategoryFallbackFlag20260827312400()[direction](runner);
    return statements.join('\n');
  };

  it('marks the existing catch-all option and enforces one active fallback', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ADD COLUMN is_fallback BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain("WHERE code = 'OTHER'");
    expect(sql).toContain('uq_follow_up_problem_categories_active_fallback');
    expect(sql).toContain('WHERE is_fallback = TRUE AND is_active = TRUE');
  });

  it('removes the additive index and column on rollback', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('DROP INDEX IF EXISTS uq_follow_up_problem_categories_active_fallback');
    expect(sql).toContain('DROP COLUMN is_fallback');
  });
});
