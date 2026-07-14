import { EnforceExecutiveAggregateOnlyAccess20260714310000 } from '../database/migrations/20260714310000-EnforceExecutiveAggregateOnlyAccess';

describe('EnforceExecutiveAggregateOnlyAccess20260714310000', () => {
  it('backs up and removes every raw default while preserving aggregate access', async () => {
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const migration = new EnforceExecutiveAggregateOnlyAccess20260714310000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).toContain('CREATE TABLE executive_aggregate_permission_backups');
    expect(sql).toContain("WHERE name = 'EXECUTIVE'");
    expect(sql).toContain("WHERE role = 'EXECUTIVE'");
    for (const permission of ['dashboard', 'students', 'review-cases', 'attendance-dashboard']) {
      expect(sql).toContain(`- '${permission}'`);
    }
    expect(sql).toContain('["home", "executive-report"]');
  });

  it('restores exact role and user permission arrays before dropping the backup', async () => {
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const migration = new EnforceExecutiveAggregateOnlyAccess20260714310000();

    await migration.down({ query } as never);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('SET default_permissions = backup.original_permissions');
    expect(sql).toContain('SET permissions = backup.original_permissions');
    expect(sql.indexOf('UPDATE users')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });
});
