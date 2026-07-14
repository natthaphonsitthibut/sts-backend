import type { QueryRunner } from 'typeorm';
import { RemoveLegacyReferralFeature20260714260000 } from '../database/migrations/20260714260000-RemoveLegacyReferralFeature';

describe('RemoveLegacyReferralFeature20260714260000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new RemoveLegacyReferralFeature20260714260000()[direction](queryRunner);
    return sql.join('\n');
  };

  it('reconciles every legacy signal before purging the domain', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("to_regclass('public.case_report_ups')");
    expect(sql).toContain("resolution_outcome = 'REFERRED_EXTERNAL'");
    expect(sql).toContain("UPPER(review.review_action) = 'FORWARD'");
    expect(sql).toContain('JOIN cases existing_case ON existing_case.id = legacy.case_id');
    expect(sql).toContain('LEFT JOIN case_report_ups report_up');
    expect(sql).toContain("status = 'REPORTED_UP'");
    expect(sql).toContain("status = 'AWAITING_HELP'");
  });

  it('purges audit/export/domain data and drops every legacy table', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("dataset_code IN ('case_summary', 'case_operational')");
    expect(sql).toContain('event_code, metadata');
    expect(sql).toContain('DELETE FROM audit_log');
    expect(sql).toContain("permission <> 'forward-case'");
    expect(sql).toContain('DROP TABLE case_referrals');
    expect(sql).toContain('DROP TABLE external_agencies');
    expect(sql).toContain('DROP TABLE case_referral_statuses');
    expect(sql).toContain('DROP TABLE related_agencies');
  });

  it('recreates rollback schema without pretending to restore purged rows', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('CREATE TABLE related_agencies');
    expect(sql).toContain('CREATE TABLE external_agencies');
    expect(sql).toContain('CREATE TABLE case_referral_statuses');
    expect(sql).toContain('CREATE TABLE case_referrals');
    expect(sql).toContain("'AWAITING_HELP', 'รอช่วยเหลือ'");
    expect(sql).not.toContain('INSERT INTO case_referrals');
    expect(sql).not.toContain('INSERT INTO related_agencies');
  });
});
