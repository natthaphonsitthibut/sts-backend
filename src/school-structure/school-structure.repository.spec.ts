import { SchoolStructureRepository } from './school-structure.repository';

describe('SchoolStructureRepository scope', () => {
  it('creates the HOMEROOM offering in the same transaction as a new classroom', async () => {
    const runner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: '42' }])
        .mockResolvedValueOnce([{ id: '84' }])
        .mockResolvedValueOnce([
          {
            id: '42',
            school_term_id: '21',
            school_id: '1001',
            grade_level_id: '4',
            legacy_room_number: 1,
            room_code: '1',
            room_name: null,
            classroom_status: 'ACTIVE',
            student_count: '0',
            is_favorite: false,
          },
        ]),
    };
    const repository = new SchoolStructureRepository({} as never);

    await expect(
      repository.createClassroom(
        {
          schoolTermId: 21,
          schoolId: 1001,
          gradeLevelId: 4,
          roomCode: '1',
          roomNumber: 1,
          roomName: null,
          actorId: 7,
        },
        runner as never,
      ),
    ).resolves.toMatchObject({ id: '42', school_id: '1001' });

    expect(runner.query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /FROM subjects[\s\S]*code = \$1[\s\S]*INSERT INTO school_subjects[\s\S]*INSERT INTO classroom_subjects/,
      ),
      ['HOMEROOM101', 1001, 7, '42'],
      true,
    );
  });

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
        userId: 7,
        termId: 21,
        gradeLevelId: 4,
        search: 'ม.1',
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
        /filtered_classrooms[\s\S]*COUNT\(DISTINCT membership\.teacher_id\)[\s\S]*COUNT\(DISTINCT enrollment\.student_uuid\)/,
      ),
      [1001, 21, 4, '%ม.1%'],
      true,
    );

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /user_classroom_favorites[\s\S]*ILIKE \$4[\s\S]*ORDER BY \(favorite\.user_id IS NOT NULL\) DESC[\s\S]*student_count DESC[\s\S]*LIMIT \$6 OFFSET \$7/,
      ),
      [1001, 21, 4, '%ม.1%', 7, 10, 10],
      true,
    );
  });

  it('lists active teachers of the school, including those without a login account', async () => {
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
      // Identity lives on `teachers` now: a teacher with no login account must
      // still be offered, so the filter is the teacher's own status.
      expect.stringMatching(
        /membership\.school_id = \$1[\s\S]*membership_status = 'ACTIVE'[\s\S]*teacher_person\.teacher_status = 'ACTIVE'/,
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
        /profile\.risk_tier[\s\S]*profile\.risk_severity[\s\S]*LEFT JOIN LATERAL[\s\S]*classroom_student_comments[\s\S]*ORDER BY COALESCE\(profile\.risk_severity, 0\) ASC[\s\S]*LIMIT \$2 OFFSET \$3/,
      ),
      [42, 10, 20],
      true,
    );
  });

  it('matches roster and attendance searches literally instead of as LIKE wildcards', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [{ total_count: 0 }], affected: 1 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await repository.listRoster({
      classroomId: 42,
      search: '50%_ก',
      sortBy: 'name',
      sortDirection: 'asc',
      page: 1,
      limit: 10,
    });
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/person\.photo_storage_key[\s\S]*ESCAPE '\\'/),
      expect.arrayContaining(['%50\\%\\_ก%']),
      true,
    );

    runner.query.mockClear();
    await repository.listClassroomStudentAttendance({
      classroomId: 42,
      search: '50%_ก',
      sortBy: 'name',
      sortDirection: 'asc',
      page: 1,
      limit: 10,
    });
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining(`ESCAPE '\\'`),
      expect.arrayContaining(['%50\\%\\_ก%']),
      true,
    );

    runner.query.mockClear();
    await repository.listClassroomDailyAttendance({
      classroomId: 42,
      search: '100%_ครู',
      sortBy: 'date',
      sortDirection: 'desc',
      page: 1,
      limit: 10,
    });
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining(`ESCAPE '\\'`),
      expect.arrayContaining(['%100\\%\\_ครู%']),
      true,
    );

    runner.query.mockClear();
    await repository.listStudentAttendanceDays({
      classroomId: 42,
      studentUuid: '00000000-0000-4000-8000-000000000001',
      search: '100%_ครู',
      sortBy: 'date',
      sortDirection: 'desc',
      page: 1,
      limit: 10,
    });
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining(`ESCAPE '\\'`),
      expect.arrayContaining(['%100\\%\\_ครู%']),
      true,
    );
  });

  it('appends a comment only when the student belongs to the classroom', async () => {
    const runner = {
      query: jest.fn().mockResolvedValue({
        records: [
          {
            id: '91',
            problem_category_code: 'ACADEMIC',
            problem_category_label: 'ปัญหาด้านการเรียน',
            problem_category_guidance: 'เช่น หมดไฟ, เรียนไม่ทัน',
            problem_description: 'ติดตาม',
            created_at: new Date(),
          },
        ],
        affected: 1,
      }),
    };
    const repository = new SchoolStructureRepository({} as never);

    await expect(
      repository.createStudentComment(
        42,
        '00000000-0000-4000-8000-000000000001',
        'ACADEMIC',
        'WATCH',
        'ติดตาม',
        7,
        runner as never,
      ),
    ).resolves.toMatchObject({
      id: '91',
      problem_category_code: 'ACADEMIC',
      problem_description: 'ติดตาม',
    });
    // Stored against the cross-term person identity, looked up from the
    // enrollment the caller addressed, so the history survives a term change.
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO classroom_student_comments[\s\S]*problem_category[\s\S]*concern_level_code[\s\S]*problem_description[\s\S]*SELECT \$1, enrollment\.person_uuid[\s\S]*enrollment\.classroom_id = \$1[\s\S]*enrollment\.deleted_at IS NULL/,
      ),
      [42, '00000000-0000-4000-8000-000000000001', 'ACADEMIC', 'WATCH', 'ติดตาม', 7],
      true,
    );
  });

  it('aggregates classroom attendance by day and resolves recorder display names', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({ records: [{ total_count: 1 }], affected: 1 })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await repository.listClassroomDailyAttendance({
      classroomId: 42,
      date: '2026-07-14',
      sortBy: 'date',
      sortDirection: 'desc',
      page: 1,
      limit: 10,
    });

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /STRING_AGG[\s\S]*recorder\.first_name[\s\S]*COUNT\(\*\) FILTER[\s\S]*LEFT JOIN teachers recorder[\s\S]*GROUP BY attendance\."AttendanceDate"/,
      ),
      [42, '2026-07-14', 10, 0],
      true,
    );
    const lastCall = (runner.query.mock.calls as Array<[string, unknown[], boolean]>).at(-1);
    expect(lastCall?.[0]).toContain(
      'LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"',
    );
  });

  it('applies inclusive start and end dates to one student attendance history', async () => {
    const runner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce({ records: [{ total_count: 0 }], affected: 1 })
        .mockResolvedValueOnce({ records: [], affected: 0 }),
    };
    const repository = new SchoolStructureRepository({
      createQueryRunner: jest.fn(() => runner),
    } as never);

    await repository.listStudentAttendanceDays({
      classroomId: 42,
      studentUuid: '00000000-0000-4000-8000-000000000001',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      sortBy: 'date',
      sortDirection: 'desc',
      page: 1,
      limit: 10,
    });

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /attendance\."AttendanceDate" >= \$3[\s\S]*attendance\."AttendanceDate" <= \$4[\s\S]*ORDER BY attendance\."AttendanceDate" DESC/,
      ),
      [42, '00000000-0000-4000-8000-000000000001', '2026-07-01', '2026-07-31', 10, 0],
      true,
    );
  });
});
