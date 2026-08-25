import type { QueryRunner } from 'typeorm';
import { AddFollowUpExecutionAndReferral20260827290000 } from './migrations/20260827290000-AddFollowUpExecutionAndReferral';

describe('AddFollowUpExecutionAndReferral20260827290000', () => {
  async function collect(direction: 'up' | 'down'): Promise<string> {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddFollowUpExecutionAndReferral20260827290000()[direction](runner);
    return statements.join('\n');
  }

  it('adds execution outcome, observations and referral history with real FKs', async () => {
    const sql = await collect('up');

    expect(sql).toContain('CREATE TABLE task_execution_outcome_options');
    expect(sql).toContain("('SUCCEEDED', 'สำเร็จ', 10)");
    expect(sql).toContain('ALTER COLUMN task_execution_outcome_code SET NOT NULL');
    expect(sql).toContain('chk_task_submissions_non_follow_up_reason');
    expect(sql).toContain('CREATE TABLE home_visit_disadvantage_observations');
    expect(sql).toContain('CREATE TABLE home_visit_disability_observations');
    expect(sql).toContain("verification_status IN ('PENDING', 'APPROVED', 'REJECTED')");
    expect(sql).toContain('CREATE TABLE referral_agencies');
    expect(sql).toContain('CREATE TABLE case_referrals');
    expect(sql).toContain('uq_case_reviews_id_case UNIQUE (id, case_id)');
    expect(sql).toContain('fk_case_referrals_review_case');
    expect(sql).toContain('FOREIGN KEY (case_review_id, case_id)');
    expect(sql).toContain('idx_home_visit_disadvantage_observations_reviewer');
    expect(sql).toContain('idx_home_visit_disability_observations_reviewer');
    expect(sql).toContain('idx_case_referrals_referrer');
    expect(sql).toContain('ALTER TABLE case_referrals ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON SEQUENCE referral_agencies_id_seq');
  });

  it('refuses lossy rollback before removing the additive contract', async () => {
    const sql = await collect('down');

    expect(sql).toContain('refusing rollback: follow-up records use the new contract');
    expect(sql).toContain('DROP TABLE case_referrals');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS uq_case_reviews_id_case');
    expect(sql).toContain('DROP CONSTRAINT fk_task_submissions_execution_outcome');
    expect(sql).toContain('DROP TABLE task_execution_outcome_options');
  });
});
