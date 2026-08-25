import type { QueryRunner } from 'typeorm';
import { AddReviewAssistanceMeasures20260827312600 } from './migrations/20260827312600-AddReviewAssistanceMeasures';

describe('AddReviewAssistanceMeasures20260827312600', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddReviewAssistanceMeasures20260827312600()[direction](runner);
    return statements.join('\n');
  };

  it('creates FK-backed multi-select proposals tied to one review', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('proposed_assistance_measure_detail TEXT NULL');
    expect(sql).toContain("proposed_assistance_measure_detail IS NULL OR review_action = 'ASSIST'");
    expect(sql).toContain('PRIMARY KEY (case_review_id, assistance_measure_code)');
    expect(sql).toContain('REFERENCES case_reviews(id) ON UPDATE CASCADE ON DELETE CASCADE');
    expect(sql).toContain(
      'REFERENCES assistance_measure_options(code) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'CREATE INDEX idx_case_review_assistance_measures_measure ON case_review_assistance_measures (assistance_measure_code)',
    );
  });

  it('drops the additive table and review detail on rollback', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_case_review_assistance_measures_measure');
    expect(sql).toContain('DROP TABLE IF EXISTS case_review_assistance_measures');
    expect(sql).toContain('DROP COLUMN IF EXISTS proposed_assistance_measure_detail');
  });
});
