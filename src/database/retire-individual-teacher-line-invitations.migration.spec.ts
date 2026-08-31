import { RetireIndividualTeacherLineInvitations20260830140000 } from './migrations/20260830140000-RetireIndividualTeacherLineInvitations';

describe('RetireIndividualTeacherLineInvitations20260830140000', () => {
  it('drops only invitation credentials and restores their schema on rollback', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    const migration = new RetireIndividualTeacherLineInvitations20260830140000();

    await migration.up(runner as never);
    expect(queries.join('\n')).toContain('DROP TABLE teacher_line_invitations');
    expect(queries.join('\n')).not.toContain('teacher_messaging_accounts');

    queries.length = 0;
    await migration.down(runner as never);
    const downSql = queries.join('\n');
    expect(downSql).toContain('CREATE TABLE teacher_line_invitations');
    expect(downSql).toContain('fk_teacher_line_invitations_membership');
    expect(downSql).toContain('uq_teacher_line_invitations_active_membership');
  });
});
