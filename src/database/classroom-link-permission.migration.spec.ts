import { RenameClassroomLinkPermission20260827220000 } from './migrations/20260827220000-RenameClassroomLinkPermission';

describe('RenameClassroomLinkPermission20260827220000', () => {
  const run = async (direction: 'up' | 'down') => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RenameClassroomLinkPermission20260827220000()[direction]({ query } as never);
    return query.mock.calls.map(([sql]) => String(sql)).join('\n');
  };

  it('renames stored permissions and grants the page to ADMIN and DIRECTOR', async () => {
    const sql = await run('up');
    expect(sql).toContain(
      "WHEN item.value = 'manage-teacher-access' THEN 'manage-classroom-links'",
    );
    expect(sql).toContain("name IN ('ADMIN', 'DIRECTOR')");
    expect(sql).toContain('SELECT DISTINCT');
  });

  it('restores the legacy permission id on rollback', async () => {
    const sql = await run('down');
    expect(sql).toContain(
      "WHEN item.value = 'manage-classroom-links' THEN 'manage-teacher-access'",
    );
  });
});
