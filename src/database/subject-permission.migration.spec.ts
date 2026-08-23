import { RenameSubjectPermission20260827250000 } from './migrations/20260827250000-RenameSubjectPermission';

describe('RenameSubjectPermission20260827250000', () => {
  const run = async (direction: 'up' | 'down') => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RenameSubjectPermission20260827250000()[direction]({ query } as never);
    return query.mock.calls.map(([sql]) => String(sql)).join('\n');
  };

  it('collapses curriculum and timetable pages into one subject permission', async () => {
    const sql = await run('up');
    expect(sql).toContain("item.value IN ('manage-curriculum', 'timetable')");
    expect(sql).toContain("THEN 'manage-subjects'");
    expect(sql).toContain("name IN ('ADMIN', 'DIRECTOR')");
    expect(sql).toContain('SELECT DISTINCT');
  });

  it('restores both legacy page permissions on rollback', async () => {
    const sql = await run('down');
    expect(sql).toContain("WHEN item.value = 'manage-subjects'");
    expect(sql).toContain("ARRAY['manage-curriculum', 'timetable']::text[]");
  });
});
