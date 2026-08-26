import { AttendanceOperationsRepository } from './attendance-operations.repository';

function createRepositoryWithQueryCapture() {
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
    repository: new AttendanceOperationsRepository(dataSource as never),
  };
}

function createExecutorWithQueryCapture(queries: Array<{ sql: string; params?: unknown[] }>) {
  return {
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
}

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
}

describe('AttendanceOperationsRepository roster policy', () => {
  it('loads submitted class metadata through current enrollment policy', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();
    const executor = createExecutorWithQueryCapture(queries);

    await repository.findClassMetadata(['00000000-0000-4000-8000-000000000001'], executor);

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
  });

  it('builds expected roster ids through current enrollment policy', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();
    const executor = createExecutorWithQueryCapture(queries);

    await repository.listRosterIds(
      {
        school_id: 10010002,
        grade_level_id: 1,
        room_id: 1,
        academic_year: 2026,
        semester: 1,
      },
      executor,
    );

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
  });

  it('lists terms without depending on calendar rows', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.listTerms(10010002);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('FROM school_terms st');
    expect(queries[0].sql).not.toContain('school_calendar_days');
  });
});
