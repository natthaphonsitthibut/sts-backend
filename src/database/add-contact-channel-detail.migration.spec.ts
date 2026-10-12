import type { QueryRunner } from 'typeorm';
import { AddContactChannelDetail20261012130000 } from './migrations/20261012130000-AddContactChannelDetail';

describe('AddContactChannelDetail20261012130000', () => {
  const collect = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddContactChannelDetail20261012130000()[direction](runner);
    return statements;
  };

  it('leaves legacy reports nullable and restricts non-empty detail to OTHER', async () => {
    const statements = await collect('up');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ADD COLUMN contact_channel_detail VARCHAR(200)');
    expect(statements[0]).toContain("contact_channel_code IS NOT DISTINCT FROM 'OTHER'");
    expect(statements[0]).toContain('char_length(btrim(contact_channel_detail)) BETWEEN 1 AND 200');
    expect(statements[0]).not.toMatch(/UPDATE|DELETE|NOT NULL|DEFAULT/);
  });

  it('refuses to discard saved details before dropping the column', async () => {
    const statements = await collect('down');
    expect(statements[0]).toContain('LOCK TABLE task_submissions IN ACCESS EXCLUSIVE MODE');
    expect(statements[0]).toContain('WHERE contact_channel_detail IS NOT NULL');
    expect(statements[0]).toContain('RAISE EXCEPTION');
    expect(statements[1]).toContain('DROP COLUMN contact_channel_detail');
  });
});
