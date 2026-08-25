import type { QueryRunner } from 'typeorm';
import { AddContactChannelOptions20260827312800 } from './migrations/20260827312800-AddContactChannelOptions';

describe('AddContactChannelOptions20260827312800', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddContactChannelOptions20260827312800()[direction](runner);
    return statements.join('\n');
  };

  it('replaces the inline CHECK list with a seeded catalog and a real FK', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain('CREATE TABLE contact_channel_options');
    expect(sql).toContain("('IN_PERSON', 'พบด้วยตนเอง', 10)");
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS chk_task_submissions_contact_channel_code');
    expect(sql).toContain(
      'FOREIGN KEY (contact_channel_code) REFERENCES contact_channel_options(code) ON UPDATE CASCADE ON DELETE RESTRICT',
    );
    expect(sql).toContain('ALTER TABLE contact_channel_options ENABLE ROW LEVEL SECURITY');
  });

  it('refuses to roll back once a report uses a channel the CHECK list cannot hold', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain('refusing rollback');
    expect(sql).toContain('ADD CONSTRAINT chk_task_submissions_contact_channel_code');
    expect(sql).toContain('DROP TABLE contact_channel_options');
  });
});
