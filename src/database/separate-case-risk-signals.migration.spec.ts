import type { QueryRunner } from 'typeorm';
import { SeparateCaseRiskSignals20260724120000 } from './migrations/20260724120000-SeparateCaseRiskSignals';

describe('SeparateCaseRiskSignals20260724120000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new SeparateCaseRiskSignals20260724120000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('moves subject-risk system notes out of human review history', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE case_risk_signals');
    expect(sql).toContain('FOREIGN KEY (case_id) REFERENCES cases(id)');
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
    expect(sql).toContain('UNIQUE (case_id, signal_source_code, signal_reason)');
    expect(sql).toContain("review.reviewed_by = 'system:subject-risk-monitor'");
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain('subject-risk review migration reconciliation failed');
    expect(sql).not.toContain(
      'ON CONFLICT (case_id, signal_source_code, signal_reason) DO NOTHING',
    );
    expect(sql).toContain('DELETE FROM case_reviews');
  });

  it('restores migrated system notes on rollback', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('INSERT INTO case_reviews');
    expect(sql).toContain("'system:subject-risk-monitor'");
    expect(sql).toContain('case review id collision prevents risk signal rollback');
    expect(sql).toContain('risk signal rollback reconciliation failed');
    expect(sql).not.toContain('ON CONFLICT (id) DO NOTHING');
    expect(sql).toContain('DROP TABLE case_risk_signals');
  });
});
