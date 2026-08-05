import type { QueryRunner } from 'typeorm';
import { SplitTaskLinkAssigneeName20260731160000 } from './migrations/20260731160000-SplitTaskLinkAssigneeName';

describe('SplitTaskLinkAssigneeName20260731160000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new SplitTaskLinkAssigneeName20260731160000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('adds constrained assignee name parts and backfills legacy full names', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('ADD COLUMN assigned_to_first_name VARCHAR(150)');
    expect(sql).toContain('ADD COLUMN assigned_to_last_name VARCHAR(150)');
    expect(sql).toContain('task_links_assigned_to_first_name_not_blank_check');
    expect(sql).toContain('REGEXP_REPLACE(BTRIM(assigned_to_name)');
    expect(sql).toContain('assigned_to_first_name = NULLIF(SPLIT_PART');
    expect(sql).toContain('assigned_to_last_name = NULLIF');
  });

  it('removes the additive assignee columns reversibly', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('DROP COLUMN IF EXISTS assigned_to_last_name');
    expect(sql).toContain('DROP COLUMN IF EXISTS assigned_to_first_name');
  });
});
