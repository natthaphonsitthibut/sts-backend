import { StudentsRepository } from './students.repository';

function createRepositoryWithQueryCapture(queries: string[]): StudentsRepository {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string) => {
      queries.push(sql);
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([{ total: 0 }]);
      }
      return Promise.resolve([]);
    }),
  };

  return new StudentsRepository({
    createQueryRunner: () => queryRunner,
  } as never);
}

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
}

describe('StudentsRepository roster queries', () => {
  it('filters student list through current enrollment policy by default', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({});

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });

  it('allows explicit all-enrollment student list mode', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({ enrollmentState: 'all' });

    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain('student_current_enrollment_resolution');
    expect(queries[1]).not.toContain('student_current_enrollment_resolution');
  });

  it('filters student filter options through current enrollment policy by default', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.getStudentFilterOptions({});

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });
});
