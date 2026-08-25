import { SplitStudentTeacherPermissions20260827312200 } from './migrations/20260827312200-SplitStudentTeacherPermissions';

describe('SplitStudentTeacherPermissions20260827312200', () => {
  const run = async (direction: 'up' | 'down') => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new SplitStudentTeacherPermissions20260827312200()[direction]({ query } as never);
    return query.mock.calls.map(([sql]) => String(sql)).join('\n');
  };

  it('preserves old grants while adding each read/manage counterpart', async () => {
    const sql = await run('up');
    expect(sql).toContain("SELECT 'manage-students'");
    expect(sql).toContain("? 'students'");
    expect(sql).toContain("SELECT 'teachers'");
    expect(sql).toContain("? 'manage-teachers'");
    expect(sql).toContain('SELECT DISTINCT');
  });

  it('restores exact pre-split permission arrays on rollback', async () => {
    const sql = await run('down');
    expect(sql).toContain('SET permissions = backup.original_permissions');
    expect(sql).toContain('SET default_permissions = backup.original_permissions');
    expect(sql).toContain('DROP TABLE student_teacher_permission_split_backup_20260827');
  });
});
