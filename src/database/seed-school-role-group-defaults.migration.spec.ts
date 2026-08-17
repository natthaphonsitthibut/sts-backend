import type { QueryRunner } from 'typeorm';
import { SeedSchoolRoleGroupDefaults20260823150000 } from './migrations/20260823150000-SeedSchoolRoleGroupDefaults';

describe('SeedSchoolRoleGroupDefaults20260823150000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new SeedSchoolRoleGroupDefaults20260823150000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('seeds only the three approved school-owned menu groups', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("('ADMIN', 'ผู้ดูแลระบบ', 'ADMIN', NULL::TEXT)");
    expect(sql).toContain("('DIRECTOR', 'ผู้อำนวยการ', 'DIRECTOR', NULL::TEXT)");
    expect(sql).toContain("('EXECUTIVE', 'ผู้บริหาร', 'EXECUTIVE', NULL::TEXT)");
    expect(sql).not.toContain('ADMIN_SCHOOL');
    expect(sql).toContain('ON CONFLICT (name) DO UPDATE');
    expect(sql).toContain('default_permissions = EXCLUDED.default_permissions');
  });

  it('reverts only the three generated default groups', async () => {
    await expect(collectSql('down')).resolves.toContain(
      "'^S[0-9]+_BASE_(ADMIN|EXECUTIVE|DIRECTOR)$'",
    );
  });

  it('refuses to revert while an account still sits in a starter group', async () => {
    // The delete would otherwise fail on the users→roles foreign key with
    // nothing but a constraint name; the guard has to name the groups instead.
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement);
        return Promise.resolve(
          statement.includes('JOIN users account')
            ? [{ name: 'S10010001_BASE_ADMIN', accounts: '2' }]
            : [],
        );
      }),
    } as unknown as QueryRunner;

    await expect(new SeedSchoolRoleGroupDefaults20260823150000().down(queryRunner)).rejects.toThrow(
      'S10010001_BASE_ADMIN (2)',
    );
    expect(statements.some((statement) => statement.includes('DELETE FROM roles'))).toBe(false);
  });
});
