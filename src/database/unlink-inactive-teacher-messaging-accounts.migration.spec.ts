import type { QueryRunner } from 'typeorm';
import { UnlinkInactiveTeacherMessagingAccounts20260807170000 } from './migrations/20260807170000-UnlinkInactiveTeacherMessagingAccounts';

describe('UnlinkInactiveTeacherMessagingAccounts20260807170000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const parameters: unknown[][] = [];
    const queryRunner = {
      query: jest.fn((statement: string, params?: unknown[]) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        parameters.push(params ?? []);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new UnlinkInactiveTeacherMessagingAccounts20260807170000()[direction](queryRunner);
    return { sql: statements.join('\n'), parameters };
  };

  it('unlinks only active bindings owned by inactive teachers without an active membership', async () => {
    const { sql, parameters } = await collectSql('up');

    expect(sql).toContain("account.provider = 'LINE'");
    expect(sql).toContain("teacher.teacher_status <> 'ACTIVE'");
    expect(sql).toContain("active_membership.membership_status = 'ACTIVE'");
    expect(sql).toContain('NOT EXISTS');
    expect(parameters.flat()).toEqual(['TEACHER_DEACTIVATED_LEGACY_CLEANUP']);
  });

  it('restores only cleanup-marked rows when neither unique binding would conflict', async () => {
    const { sql, parameters } = await collectSql('down');

    expect(sql).toContain('SET unlinked_at = NULL');
    expect(sql).toContain('conflict.provider_user_id = account.provider_user_id');
    expect(sql).toContain('conflict.teacher_id = account.teacher_id');
    expect(parameters.flat()).toEqual(['TEACHER_DEACTIVATED_LEGACY_CLEANUP']);
  });
});
