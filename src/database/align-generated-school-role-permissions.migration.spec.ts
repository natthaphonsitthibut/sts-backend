import type { QueryRunner } from 'typeorm';
import { AlignGeneratedSchoolRolePermissions20260807181000 } from './migrations/20260807181000-AlignGeneratedSchoolRolePermissions';

describe('AlignGeneratedSchoolRolePermissions20260807181000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const parameters: unknown[][] = [];
    const queryRunner = {
      query: jest.fn((statement: string, params?: unknown[]) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        parameters.push(params ?? []);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AlignGeneratedSchoolRolePermissions20260807181000()[direction](queryRunner);
    return { sql: statements.join('\n'), parameters };
  };

  it('aligns only untouched generated ADMIN and DIRECTOR baselines', async () => {
    const { sql, parameters } = await collectSql('up');

    expect(sql).toContain('FOREIGN KEY (role_id) REFERENCES roles(id)');
    expect(sql).toContain("generated_role.name ~ '^S[0-9]+_BASE_ADMIN$'");
    expect(sql).toContain("generated_role.name ~ '^S[0-9]+_BASE_DIRECTOR$'");
    expect(sql).toContain('generated_role.default_permissions = (');
    expect(parameters.flat()).toEqual([
      'manage-teachers',
      'manage-curriculum',
      'manage-teacher-access',
    ]);
  });

  it('restores only roles unchanged since alignment', async () => {
    const { sql } = await collectSql('down');

    expect(sql).toContain('role_record.default_permissions = backup.aligned_permissions');
    expect(sql).toContain('DROP TABLE school_role_permission_alignment_backups_20260807');
  });
});
