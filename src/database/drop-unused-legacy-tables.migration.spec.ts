import { DropUnusedLegacyTables20260925140000 } from './migrations/20260925140000-DropUnusedLegacyTables';

describe('DropUnusedLegacyTables migration', () => {
  it('refuses to drop tables that came back into use before dropping all four', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new DropUnusedLegacyTables20260925140000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('RAISE EXCEPTION');
    for (const table of [
      'attendance_import_files',
      'school_structure_backfill_issues',
      'external_users',
      'schedules',
    ]) {
      expect(sql).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropUnusedLegacyTables20260925140000().down()).rejects.toThrow(
      'intentionally irreversible',
    );
  });
});
