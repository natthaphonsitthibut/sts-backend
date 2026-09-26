import { DropArchivedMigrationBackups20260925150000 } from './migrations/20260925150000-DropArchivedMigrationBackups';

describe('DropArchivedMigrationBackups migration', () => {
  it('drops only the archived snapshots and keeps those still in use', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    await new DropArchivedMigrationBackups20260925150000().up(runner as never);

    const sql = queries.join('\n');
    expect(queries).toHaveLength(26);
    expect(sql).toContain(
      'DROP TABLE IF EXISTS "migration_20260827313400_burapha_student_address_backup"',
    );
    for (const kept of [
      'user_role_scope_migration_backup',
      'director_permission_demotion_backup_20260922',
      'user_scope_fix_backup_20260925',
    ]) {
      expect(sql).not.toContain(kept);
    }
  });

  it('is explicitly irreversible', async () => {
    await expect(new DropArchivedMigrationBackups20260925150000().down()).rejects.toThrow(
      'intentionally irreversible',
    );
  });
});
