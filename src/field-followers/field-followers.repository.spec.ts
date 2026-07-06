import { FieldFollowersRepository } from './field-followers.repository';

describe('FieldFollowersRepository', () => {
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
    const repository = new FieldFollowersRepository(dataSource as never);
    return { repository, queries };
  }

  it('applies no scope filter for a global actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.listFollowers({ global: true }, { page: 1, limit: 20 });

    expect(queries[0].sql).not.toContain('province = ANY');
    expect(queries[0].sql).not.toContain('1=0');
  });

  it('filters by province/district/sub_district arrays for an area-scoped actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.listFollowers(
      { provinces: ['เชียงใหม่'], districts: ['เมืองเชียงใหม่'] },
      { page: 1, limit: 20 },
    );

    expect(queries[0].sql).toContain('province = ANY($1::text[])');
    expect(queries[0].sql).toContain('district = ANY($2::text[])');
    expect(queries[0].params).toEqual(expect.arrayContaining([['เชียงใหม่'], ['เมืองเชียงใหม่']]));
  });

  it('falls back to the actor school_ids resolved via schools for a school-scoped actor', async () => {
    const { repository, queries } = buildRepository();

    await repository.listFollowers({ school_ids: [10010002] }, { page: 1, limit: 20 });

    expect(queries[0].sql).toContain('EXISTS (');
    expect(queries[0].sql).toContain('FROM schools sc');
    expect(queries[0].params).toEqual(expect.arrayContaining([[10010002]]));
  });

  it('fails closed (0 rows) when a non-global actor has no area or school scope', async () => {
    const { repository, queries } = buildRepository();

    await repository.listFollowers({}, { page: 1, limit: 20 });

    expect(queries[0].sql).toContain('(1=0)');
  });

  it('scopes findByIdInScope the same way as listFollowers', async () => {
    const { repository, queries } = buildRepository();

    await repository.findByIdInScope('1', { provinces: ['เชียงใหม่'] });

    expect(queries[0].sql).toContain('province = ANY($2::text[])');
    expect(queries[0].params).toEqual(['1', ['เชียงใหม่']]);
  });
});
