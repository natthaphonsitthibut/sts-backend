import { TeachersRepository } from './teachers.repository';

describe('TeachersRepository', () => {
  it('sorts the full paginated dataset with a whitelisted server column', async () => {
    const queries: string[] = [];
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        queries.push(sql);
        return Promise.resolve({
          records: queries.length === 1 ? [{ count: 0 }] : [],
          affected: 0,
        });
      }),
    };
    const repository = new TeachersRepository({ createQueryRunner: () => runner } as never);

    await repository.listTeachers({
      schoolId: 10,
      sortBy: 'email',
      sortOrder: 'desc',
      page: 1,
      limit: 20,
    });

    expect(queries[1]).toContain('ORDER BY teacher.email DESC NULLS LAST, teacher.id DESC');
  });
});
