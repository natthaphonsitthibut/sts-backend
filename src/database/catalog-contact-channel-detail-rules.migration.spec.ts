import type { QueryRunner } from 'typeorm';
import { CatalogContactChannelDetailRules20261012140000 } from './migrations/20261012140000-CatalogContactChannelDetailRules';

describe('CatalogContactChannelDetailRules20261012140000', () => {
  it('keeps legacy null details and validates saved detail against the catalog', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new CatalogContactChannelDetailRules20261012140000().up(runner);
    expect(statements.join(' ')).toContain('requires_detail BOOLEAN NOT NULL DEFAULT FALSE');
    expect(statements[0]).toContain('contact_channel_detail IS NULL');
    expect(statements[1]).toContain(
      'channel.code = NEW.contact_channel_code AND channel.requires_detail',
    );
    expect(statements[1]).toContain("ERRCODE = '23514'");
    expect(statements[1]).not.toContain('SECURITY DEFINER');
  });

  it('checks data compatibility before removing the catalog guard', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new CatalogContactChannelDetailRules20261012140000().down(runner);
    const sql = statements.join(' ');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP TRIGGER'));
    expect(sql).toContain('DROP FUNCTION enforce_task_submission_contact_channel_detail()');
    expect(sql).toContain("contact_channel_code IS NOT DISTINCT FROM 'OTHER'");
  });
});
