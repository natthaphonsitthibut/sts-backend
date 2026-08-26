import { RestrictSettingsToGlobalAdmins20260827330000 } from './migrations/20260827330000-RestrictSettingsToGlobalAdmins';

function runMigration(direction: 'up' | 'down'): Promise<string> {
  const queries: string[] = [];
  const migration = new RestrictSettingsToGlobalAdmins20260827330000();
  const runner = {
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve([]);
    }),
  } as never;

  return (direction === 'up' ? migration.up(runner) : migration.down(runner)).then(() =>
    queries.join('\n'),
  );
}

describe('RestrictSettingsToGlobalAdmins migration', () => {
  it('takes the settings page off every role and account but ADMIN', async () => {
    const sql = await runMigration('up');

    expect(sql).toContain("permission <> 'settings'");
    expect(sql).toContain("WHERE name <> 'ADMIN' AND COALESCE(default_permissions, '[]'::jsonb) ?");
    expect(sql).toContain("WHERE account.role IS DISTINCT FROM 'ADMIN'");
    // ADMIN keeps the page: the guard is the role plus national scope, and this
    // migration must not be the thing that locks the last holder out.
    expect(sql).not.toMatch(/UPDATE roles[\s\S]*WHERE name = 'ADMIN'/);
  });

  it('refuses to strand a group whose only page is the settings page', async () => {
    const sql = await runMigration('up');

    expect(sql).toContain('jsonb_array_length');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('restores the recorded originals on rollback', async () => {
    const sql = await runMigration('down');

    expect(sql).toContain('settings_permission_scope_backup_20260827');
    expect(sql).toContain('SET default_permissions = backup.original');
    expect(sql).toContain('SET permissions = backup.original');
  });
});
