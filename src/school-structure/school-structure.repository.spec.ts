import { SchoolStructureRepository } from './school-structure.repository';

describe('SchoolStructureRepository scope', () => {
  it('lists active schools with the authenticated scope embedded in SQL', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };
    const repository = new SchoolStructureRepository(dataSource as never);

    await repository.listScopedSchools({ school_ids: [1001] });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /school\.school_status = 'ACTIVE'[\s\S]*school\.id = ANY\(\$1::int\[\]\)/,
      ),
      [[1001]],
      true,
    );
  });

  it('pushes authenticated school scope into the SQL predicate', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [{ allowed: true }], affected: 1 }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => runner),
    };
    const repository = new SchoolStructureRepository(dataSource as never);

    await expect(
      repository.isSchoolInScope(1001, { school_ids: [1001], provinces: ['เชียงใหม่'] }),
    ).resolves.toBe(true);
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /school\.id = ANY\(\$2::int\[\]\)[\s\S]*school\.province = ANY\(\$3::text\[\]\)/,
      ),
      [1001, [1001], ['เชียงใหม่']],
      true,
    );
  });

  it('fails closed for an unconfigured scope', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => runner),
    };
    const repository = new SchoolStructureRepository(dataSource as never);

    await expect(repository.isSchoolInScope(1001, {})).resolves.toBe(false);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('AND 1=0'), [1001], true);
  });
});
