import type { QueryRunner } from 'typeorm';
import { AddCaseReferralStatuses20260827312900 } from './migrations/20260827312900-AddCaseReferralStatuses';

describe('AddCaseReferralStatuses20260827312900', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddCaseReferralStatuses20260827312900()[direction](runner);
    return statements.join('\n');
  };

  it('replaces the status CHECK list with the shared workflow status shape', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('CREATE TABLE case_referral_statuses');
    expect(sql).toContain("('REFERRED', 'ส่งต่อแล้ว', 'secondary', 10)");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS chk_case_referrals_status');
    expect(sql).toContain(
      'FOREIGN KEY (status_code) REFERENCES case_referral_statuses(code) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(sql).toContain('ALTER TABLE case_referral_statuses ENABLE ROW LEVEL SECURITY');
  });

  it('refuses to roll back once a referral uses an added status', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain('refusing rollback');
    expect(sql).toContain('ADD CONSTRAINT chk_case_referrals_status');
    expect(sql).toContain('DROP TABLE case_referral_statuses');
  });
});
