import { AttendanceRepository } from './attendance.repository';

describe('AttendanceRepository', () => {
  function createRepository() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };

    return {
      queries,
      repository: new AttendanceRepository(dataSource as never),
    };
  }

  it('includes the active link time range in the attendance task list', async () => {
    const { queries, repository } = createRepository();

    await repository.listAttendanceTasks();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('tl.created_at as active_link_created_at');
    expect(queries[0].sql).toContain('tl.expires_at as active_link_expires_at');
    expect(queries[0].sql).toContain("WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'");
    expect(queries[0].sql).toContain('FROM attendance_sessions attendance_session');
  });

  it('includes the active link time range in the paginated task list', async () => {
    const { queries, repository } = createRepository();

    await repository.listAttendanceTasksPaginated(undefined, {
      page: 1,
      limit: 20,
    });

    const listQuery = queries.at(-1);
    expect(listQuery?.sql).toContain('tl.created_at as active_link_created_at');
    expect(listQuery?.sql).toContain('tl.expires_at as active_link_expires_at');
    expect(listQuery?.sql).toContain('tl.expires_at <= NOW()');
    expect(listQuery?.sql).toContain('AS link_state');
    expect(listQuery?.sql).toContain("WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'");
    expect(listQuery?.sql).toContain('FROM attendance_sessions attendance_session');
  });
});
