import { TeachersRepository } from './teachers.repository';

describe('TeachersRepository', () => {
  it('scopes classroom-link profile reads to an active homeroom classroom', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string, params: unknown[]) => {
        queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        return Promise.resolve({ records: [], affected: 0 });
      }),
    };
    const repository = new TeachersRepository({ createQueryRunner: () => runner } as never);

    await repository.findActiveHomeroomTeacherInScope('7', {
      school_ids: [10],
      grade_levels: [1],
      room_ids: [2],
    });

    expect(queries[0].sql).toContain('FROM classroom_homeroom_teachers homeroom');
    expect(queries[0].sql).toContain("teacher.teacher_status = 'ACTIVE'");
    expect(queries[0].sql).toContain("classroom.classroom_status = 'ACTIVE'");
    expect(queries[0].params).toEqual(['7', [10], [1], [2]]);
  });

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

  it('unlinks LINE only after the teacher has no active school membership', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn().mockImplementation((sql: string) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
    const repository = new TeachersRepository({} as never);

    await repository.deactivateTeacher(
      { teacherId: '7', membershipId: '5', actorId: 1 },
      runner as never,
    );

    const unlinkSql = queries.find((sql) => sql.includes('UPDATE teacher_messaging_accounts'));
    expect(unlinkSql).toContain("unlinked_reason = 'TEACHER_DEACTIVATED'");
    expect(unlinkSql).toContain("active_membership.membership_status = 'ACTIVE'");
    expect(unlinkSql).toContain('NOT EXISTS');
    expect(runner.query).toHaveBeenLastCalledWith(expect.any(String), ['7', 1], true);
  });
});
