import type { QueryRunner } from 'typeorm';
import { AddReferralReportLinks20261009100000 } from './migrations/20261009100000-AddReferralReportLinks';

describe('AddReferralReportLinks20261009100000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddReferralReportLinks20261009100000()[direction](runner);
    return statements.join('\n');
  };

  it('stores the link token hashed and encrypted, and the code hashed only', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('token_hash VARCHAR(128) NOT NULL');
    expect(sql).toContain('token_encrypted TEXT NOT NULL');
    expect(sql).toContain('access_code_hash VARCHAR(128) NOT NULL');
    expect(sql).not.toMatch(/access_code VARCHAR|access_code TEXT/);
  });

  it('keeps one open link per referral, inside a window that ends after it starts', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain(
      "CREATE UNIQUE INDEX uq_case_referral_links_active ON case_referral_links (case_referral_id) WHERE status_code = 'ACTIVE'",
    );
    expect(sql).toContain('CHECK (expires_at > starts_at)');
  });

  it('records who reported through a link, by provider and subject, never a citizen id', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('ADD COLUMN reporter_provider_subject VARCHAR(100)');
    expect(sql).toContain('REFERENCES identity_providers(code)');
    expect(sql).toContain(
      'REFERENCES case_referral_links(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(sql).not.toMatch(/identity_number|citizen_id/);
  });

  it('refuses to roll back once an agency has reported through a link', async () => {
    expect(await collectSql('down')).toContain(
      'refusing rollback: agencies have reported through referral links',
    );
  });
});
