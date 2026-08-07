import type { QueryRunner } from 'typeorm';
import { MaterializeLegacyUserPermissions20260807180000 } from './migrations/20260807180000-MaterializeLegacyUserPermissions';

describe('MaterializeLegacyUserPermissions20260807180000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new MaterializeLegacyUserPermissions20260807180000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('backs up and materializes only empty arrays from non-empty role defaults', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES users(id)');
    expect(sql).toContain('jsonb_array_length(user_record.permissions) = 0');
    expect(sql).toContain('jsonb_array_length(role_record.default_permissions) > 0');
    expect(sql).toContain('SET permissions = backup.materialized_permissions');
  });

  it('restores only rows unchanged since migration', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('user_record.permissions = backup.materialized_permissions');
    expect(sql).toContain('DROP TABLE user_permission_materialization_backups_20260807');
  });
});
