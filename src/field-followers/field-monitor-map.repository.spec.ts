import { FieldMonitorMapRepository } from './field-monitor-map.repository';

describe('FieldMonitorMapRepository', () => {
  function buildRepository() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new FieldMonitorMapRepository(dataSource as never);
    return { repository, queries };
  }

  const uuids = ['11111111-1111-4111-8111-111111111111'];

  it('always filters by the explicit student_uuid list', async () => {
    const { repository, queries } = buildRepository();

    await repository.getPins(uuids, { global: true });

    expect(queries[0].sql).toContain('s.student_uuid = ANY($1::uuid[])');
    expect(queries[0].params?.[0]).toEqual(uuids);
  });

  it('applies no extra scope filter for a global actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.getPins(uuids, { global: true });

    expect(queries[0].sql).not.toContain('1=0');
    expect(queries[0].sql).not.toContain('sc.province = ANY');
  });

  it('filters by school_ids for a school-scoped actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.getPins(uuids, { school_ids: [10010002] });

    expect(queries[0].sql).toContain(`s."SchoolID_Onec" = ANY($2::int[])`);
    expect(queries[0].params).toEqual([uuids, [10010002]]);
  });

  it('fails closed (0 rows) when a non-global actor has no scope at all', async () => {
    const { repository, queries } = buildRepository();

    await repository.getPins(uuids, {});

    expect(queries[0].sql).toContain('(1=0)');
  });

  it('joins the latest non-null case coordinates via a lateral subquery', async () => {
    const { repository, queries } = buildRepository();

    await repository.getPins(uuids, { global: true });

    expect(queries[0].sql).toContain('LEFT JOIN LATERAL');
    expect(queries[0].sql).toContain('ORDER BY c.created_at DESC');
    expect(queries[0].sql).toContain('c.deleted_at IS NULL');
  });
});
