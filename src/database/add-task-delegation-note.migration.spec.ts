import type { QueryRunner } from 'typeorm';
import { AddTaskDelegationNote20260731150000 } from './migrations/20260731150000-AddTaskDelegationNote';

describe('AddTaskDelegationNote20260731150000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddTaskDelegationNote20260731150000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('adds a domain-specific nullable note for delegated links', async () => {
    await expect(collectSql('up')).resolves.toContain(
      'ALTER TABLE task_links ADD COLUMN delegation_note TEXT',
    );
  });

  it('removes the delegation note reversibly', async () => {
    await expect(collectSql('down')).resolves.toContain(
      'ALTER TABLE task_links DROP COLUMN IF EXISTS delegation_note',
    );
  });
});
