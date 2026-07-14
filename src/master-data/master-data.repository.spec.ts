import { MasterDataRepository } from './master-data.repository';

describe('MasterDataRepository school scope', () => {
  it('pushes school scope into the SQL query instead of filtering rows in memory', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue([]),
    };
    const repository = new MasterDataRepository({} as never);

    await repository.findSchoolById(
      2002,
      { school_ids: [1001], provinces: ['เชียงใหม่'] },
      queryRunner as never,
    );

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /sc\.id = ANY\(\$2::int\[\]\)[\s\S]*sc\.province = ANY\(\$3::text\[\]\)[\s\S]*FOR UPDATE/,
      ),
      [2002, [1001], ['เชียงใหม่']],
    );
  });

  it('uses a fail-closed predicate for an unconfigured scope', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue([]),
    };
    const repository = new MasterDataRepository({} as never);

    await repository.findSchoolById(1001, {}, queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE sc.id = $1 AND 1=0'),
      [1001],
    );
  });
});
