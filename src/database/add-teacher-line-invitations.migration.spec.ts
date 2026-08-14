import type { QueryRunner } from 'typeorm';
import { AddTeacherLineInvitations20260810130000 } from './migrations/20260810130000-AddTeacherLineInvitations';

describe('AddTeacherLineInvitations20260810130000', () => {
  it('creates a hash-only, single-active and reversible invitation table', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const runner = { query } as unknown as QueryRunner;
    const migration = new AddTeacherLineInvitations20260810130000();

    await migration.up(runner);
    await migration.down(runner);

    const calls = query.mock.calls as unknown as Array<[string]>;
    const upSql = String(calls[0]?.[0]).replace(/\s+/g, ' ');
    const downSql = String(calls[1]?.[0]).replace(/\s+/g, ' ');
    expect(upSql).toContain('token_hash CHAR(64) NOT NULL');
    expect(upSql).not.toContain('token_encrypted');
    expect(upSql).toContain('uq_teacher_line_invitations_active_membership');
    expect(upSql).toContain('FOREIGN KEY (teacher_membership_id)');
    expect(upSql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(downSql).toContain('DROP TABLE teacher_line_invitations');
  });
});
