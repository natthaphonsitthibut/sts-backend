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

  it('applies classroom filters, server sort, and pagination in SQL', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({
          records: [{ classroom_count: 21, teacher_count: 3, student_count: 210 }],
          affected: 1,
        })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await expect(
      repository.listClassrooms({
        schoolId: 1001,
        termId: 21,
        gradeLevelId: 4,
        sortBy: 'students',
        sortDirection: 'desc',
        page: 2,
        limit: 10,
      }),
    ).resolves.toEqual({
      rows: [],
      totalCount: 21,
      teacherCount: 3,
      studentCount: 210,
    });

    expect(runner.query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(
        /filtered_classrooms[\s\S]*COUNT\(DISTINCT membership\.teacher_user_id\)[\s\S]*COUNT\(DISTINCT enrollment\.student_uuid\)/,
      ),
      [1001, 21, 4],
      true,
    );

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(/ORDER BY student_count DESC[\s\S]*LIMIT \$4 OFFSET \$5/),
      [1001, 21, 4, 10, 10],
      true,
    );
  });

  it('lists only active teacher-role membership options for the selected school', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await repository.listTeacherOptions(1001, 'สมชาย');

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /membership\.school_id = \$1[\s\S]*membership_status = 'ACTIVE'[\s\S]*teacher\.role = 'TEACHER'/,
      ),
      [1001, '%สมชาย%'],
      true,
    );
  });

  it('filters the paginated teacher table by the same classroom context as the summary', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({ records: [{ total_count: 1, active_count: 1 }], affected: 1 })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await expect(
      repository.listTeachers({
        schoolId: 1001,
        termId: 21,
        gradeLevelId: 4,
        classroomId: 42,
        assignedToFilteredClassrooms: true,
        sortBy: 'name',
        sortDirection: 'asc',
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual({ rows: [], totalCount: 1, activeCount: 1 });

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /classroom\.school_term_id = \$2[\s\S]*classroom\.grade_level_id = \$3[\s\S]*classroom\.id = \$4[\s\S]*LIMIT \$5 OFFSET \$6/,
      ),
      [1001, 21, 4, 42, 10, 0],
      true,
    );
  });

  it('preserves the school-wide teacher membership list when assignment filtering is omitted', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({ records: [{ total_count: 2, active_count: 1 }], affected: 1 })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await expect(
      repository.listTeachers({
        schoolId: 1001,
        sortBy: 'name',
        sortDirection: 'asc',
        page: 1,
        limit: 10,
      }),
    ).resolves.toEqual({ rows: [], totalCount: 2, activeCount: 1 });

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /FROM school_teacher_memberships membership[\s\S]*WHERE membership\.school_id = \$1[\s\S]*LIMIT \$2 OFFSET \$3/,
      ),
      [1001, 10, 0],
      true,
    );
  });

  it('applies roster status sorting and pagination in SQL', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({ records: [{ total_count: 30 }], affected: 1 })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await expect(
      repository.listRoster({
        classroomId: 42,
        sortBy: 'status',
        sortDirection: 'asc',
        page: 3,
        limit: 10,
      }),
    ).resolves.toEqual({ rows: [], totalCount: 30 });

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /status\.badge_variant AS student_status_badge_variant[\s\S]*ORDER BY COALESCE\(status\.label_th, ''\) ASC[\s\S]*LIMIT \$2 OFFSET \$3/,
      ),
      [42, 10, 20],
      true,
    );
  });
});
