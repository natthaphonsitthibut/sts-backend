import type { QueryRunner } from 'typeorm';
import { BackfillLegacyReferralResults20261008110000 } from './migrations/20261008110000-BackfillLegacyReferralResults';

describe('BackfillLegacyReferralResults20261008110000', () => {
  const collectSql = async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new BackfillLegacyReferralResults20261008110000().up(runner);
    return statements;
  };

  it('writes the result rows before it rewrites the statuses they quote', async () => {
    const statements = await collectSql();
    expect(statements[0]).toMatch(/^INSERT INTO case_referral_results/);
    expect(statements.at(-1)).toMatch(/^UPDATE case_referrals referral SET status_code/);
  });

  it('ties every backfilled result to its referral and to the user who sent it', async () => {
    const [insert] = await collectSql();
    expect(insert).toContain('case_referral_id, result_note, recorded_at, recorded_by_user_id');
    expect(insert).toContain('COALESCE(referral.referred_by_user_id, review.source_actor_user_id)');
    expect(insert).toContain('NOT EXISTS ( SELECT 1 FROM case_referral_results recorded');
  });

  it('leaves a case still waiting on its referral alone', async () => {
    const statements = await collectSql();
    for (const sql of [statements[0], statements.at(-1)]) {
      expect(sql).toContain("c.status <> 'AWAITING_REFERRAL_OUTCOME'");
    }
  });

  it('maps refused and cancelled referrals to ยังไม่สำเร็จ and the rest to สำเร็จ', async () => {
    const update = (await collectSql()).at(-1);
    expect(update).toContain(
      "WHEN referral.status_code IN ('DECLINED', 'CANCELLED') THEN 'NOT_SUCCEEDED' ELSE 'COMPLETED'",
    );
  });
});
