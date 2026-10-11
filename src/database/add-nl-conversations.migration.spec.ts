import { AddNlConversations20261010100000 } from './migrations/20261010100000-AddNlConversations';

function runner() {
  const queries: string[] = [];
  return {
    queries,
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    }),
  };
}

describe('AddNlConversations migration', () => {
  it('creates both tables, the ownership index and the audit link', async () => {
    const r = runner();
    await new AddNlConversations20261010100000().up(r as never);
    const sql = r.queries.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nl_conversation ');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nl_conversation_turn');
    expect(sql).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE (conversation_id, seq)');
    expect(sql).toContain('(user_id, updated_at DESC) WHERE deleted_at IS NULL');
    expect(sql).toContain('ALTER TABLE nl_query_log');
    expect(sql).toContain('conversation_id UUID NULL');
  });

  it('down() removes the audit link before dropping the tables', async () => {
    const r = runner();
    await new AddNlConversations20261010100000().down(r as never);
    const sql = r.queries.join('\n');

    expect(sql.indexOf('DROP COLUMN IF EXISTS conversation_id')).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf('DROP COLUMN IF EXISTS conversation_id')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS nl_conversation_turn'),
    );
    expect(sql.indexOf('DROP TABLE IF EXISTS nl_conversation_turn')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS nl_conversation;'),
    );
  });
});
