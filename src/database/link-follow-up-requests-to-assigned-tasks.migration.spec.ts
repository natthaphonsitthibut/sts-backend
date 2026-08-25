import type { QueryRunner } from 'typeorm';
import { LinkFollowUpRequestsToAssignedTasks20260714290000 } from './migrations/20260714290000-LinkFollowUpRequestsToAssignedTasks';

describe('LinkFollowUpRequestsToAssignedTasks20260714290000', () => {
  it('adds a reversible, FK-backed and internally consistent assignment link', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    const migration = new LinkFollowUpRequestsToAssignedTasks20260714290000();

    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const up = statements[0];
    const down = statements[1];
    expect(up).toContain('ADD COLUMN assigned_task_id UUID');
    expect(up).toContain('FOREIGN KEY (assigned_task_id) REFERENCES tasks(id)');
    expect(up).toContain('FOREIGN KEY (assigned_by) REFERENCES users(id)');
    expect(up).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(up).toContain("status = 'APPROVE_AND_ASSIGN'");
    expect(up).toContain('CREATE UNIQUE INDEX uq_follow_up_requests_assigned_task');
    expect(down).toContain('DROP COLUMN IF EXISTS assigned_task_id');
    expect(down).toContain('DROP COLUMN IF EXISTS assigned_by');
    expect(down).toContain('DROP COLUMN IF EXISTS assigned_at');
  });
});
