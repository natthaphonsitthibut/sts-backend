import type { QueryRunner } from 'typeorm';
import { AddReferralOutcomeTracking20261008100000 } from './migrations/20261008100000-AddReferralOutcomeTracking';

describe('AddReferralOutcomeTracking20261008100000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddReferralOutcomeTracking20261008100000()[direction](runner);
    return statements;
  };

  it('parks referred cases in รอผลการส่งต่อ instead of closing them', async () => {
    const sql = (await collectSql('up')).join('\n');
    expect(sql).toContain("('AWAITING_REFERRAL_OUTCOME', 'รอผลการส่งต่อ', 'warning', 25)");
    expect(sql).toContain("('NOT_SUCCEEDED', 'ยังไม่สำเร็จ', 'destructive', 35)");
    expect(sql).toContain(
      "SET target_case_status_code = 'AWAITING_REFERRAL_OUTCOME', completion_outcome_code = NULL WHERE code = 'REFER_AGENCY'",
    );
  });

  it('keeps a waiting student to one active case', async () => {
    const statements = await collectSql('up');
    const index = statements.find((sql) =>
      sql.startsWith('CREATE UNIQUE INDEX uq_cases_active_student_uuid'),
    );
    expect(index).toContain("'AWAITING_REFERRAL_OUTCOME'");
    expect(index).toContain("'STUDENT_NOT_FOUND'");
  });

  it('stores one result per referral with real foreign keys and no direct client access', async () => {
    const sql = (await collectSql('up')).join('\n');
    expect(sql).toContain('case_referral_id UUID PRIMARY KEY');
    expect(sql).toContain(
      'FOREIGN KEY (case_referral_id) REFERENCES case_referrals(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(sql).toContain(
      'FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL',
    );
    expect(sql).toContain('length(btrim(result_note)) BETWEEN 1 AND 2000');
    expect(sql).toContain('ALTER TABLE case_referral_results ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE case_referral_results');
  });

  it('refuses to roll back once the new flow holds data, then restores the old action', async () => {
    const statements = await collectSql('down');
    expect(statements[0]).toContain('refusing rollback: cases are waiting on a referral outcome');
    expect(statements[0]).toContain('refusing rollback: referral outcomes have been recorded');
    const sql = statements.join('\n');
    expect(sql).toContain(
      "SET target_case_status_code = 'RESOLVED', completion_outcome_code = 'REFERRED_AGENCY'",
    );
    expect(sql).toContain('DROP TABLE case_referral_results');
    expect(sql).toContain(
      "DELETE FROM case_workflow_statuses WHERE code = 'AWAITING_REFERRAL_OUTCOME'",
    );
  });
});
