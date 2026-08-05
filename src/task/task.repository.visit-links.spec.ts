import { TaskRepository } from './task.repository';

describe('TaskRepository visit links', () => {
  it('lists only VISIT links inside the actor case scope', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return {
            records: [{ total: 1, active: 1, locked: 0, expired: 0, scheduled: 0 }],
            affected: 1,
          };
        }
        if (queries.length === 2) {
          return { records: [{ count: 1 }], affected: 1 };
        }
        return {
          records: [
            {
              id: 'visit-link-1',
              task_id: 'visit-task-1',
              case_id: 10,
              task_type: 'VISIT',
              link_state: 'ACTIVE',
              token_encrypted: null,
            },
          ],
          affected: 1,
        };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    const result = await repository.listVisitLinksPaginated(
      {
        id: 7,
        username: 'case-admin',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['review-cases'],
        data_scope: { school_ids: [101] },
      },
      {
        status: 'ACTIVE',
        page: 1,
        limit: 20,
      },
    );

    expect(result.totalCount).toBe(1);
    expect(result.summary).toEqual({
      total: 1,
      active: 1,
      locked: 0,
      expired: 0,
      scheduled: 0,
    });
    expect(result.rows[0]).toMatchObject({
      id: 'visit-link-1',
      task_id: 'visit-task-1',
      case_id: 10,
      task_type: 'VISIT',
      link_state: 'ACTIVE',
      magic_link: null,
    });
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.sql).toContain("t.task_type = 'VISIT'");
      expect(query.sql).toContain('c.school_id = ANY($1::int[])');
      expect(query.params?.[0]).toEqual([101]);
    }
    expect(queries[0].params).toEqual([[101]]);
    expect(queries[1].params).toEqual([[101], 'ACTIVE']);
    expect(queries[2].params).toEqual([[101], 'ACTIVE', 20, 0]);
  });

  it('keeps LOGIN and ATTENDANCE task types out of the visit-link endpoint query', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return {
            records: [{ total: 0, active: 0, locked: 0, expired: 0, scheduled: 0 }],
            affected: 1,
          };
        }
        if (queries.length === 2) {
          return { records: [{ count: 0 }], affected: 1 };
        }
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    await repository.listVisitLinksPaginated(undefined, {
      searchTerm: 'teacher',
      page: 1,
      limit: 10,
    });

    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.sql).toContain("t.task_type = 'VISIT'");
      expect(query.sql).not.toContain("t.task_type = 'LOGIN'");
      expect(query.sql).not.toContain("t.task_type = 'ATTENDANCE'");
    }
  });
});
