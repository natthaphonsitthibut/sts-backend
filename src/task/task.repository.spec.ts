import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
  it('counts distinct active-case students within the actor scope', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: '2' }], affected: 1 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const repository = new TaskRepository(dataSource as never);

    const count = await repository.countAtRiskStudents({
      id: 7,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['view-dashboard'],
      data_scope: {
        school_ids: [101],
        grade_levels: [6],
        own_only: true,
      },
    });

    expect(count).toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      ['OPEN', 'IN_PROGRESS', 'AWAITING_HELP', 'PENDING_REVIEW'],
      [101],
      [6],
      7,
    ]);
    expect(queries[0].sql).toContain('count(DISTINCT CASE');
    expect(queries[0].sql).toContain('c.status = ANY($1::text[])');
    expect(queries[0].sql).toContain('c.school_id = ANY($2::int[])');
    expect(queries[0].sql).toContain('case_scope_student."GradeLevelID_Onec" = ANY($3::int[])');
    expect(queries[0].sql).toContain('c.created_by = $4');
    expect(queries[0].sql).toContain('c.deleted_at IS NULL');
  });
});
