import { UsersRepository } from './users.repository';

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
  expect(sql).not.toContain('"StudentStatusID_Onec" = 10');
}

describe('UsersRepository student account queries', () => {
  it('filters account-generation candidates through current enrollment policy', async () => {
    const queries: string[] = [];
    const repository = new UsersRepository({} as never);
    const executor = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await repository.listStudentAccountCandidates({ schoolId: 10010002 }, executor);

    expectCurrentEnrollmentPolicy(queries[0]);
  });

  it('filters managed student accounts through current enrollment policy', async () => {
    const queries: string[] = [];
    const repository = new UsersRepository({
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((sql: string) => {
          queries.push(sql);
          return queries.length === 1
            ? Promise.resolve({ records: [{ count: 0 }], affected: 1 })
            : Promise.resolve({ records: [], affected: 0 });
        }),
      }),
    } as never);

    await repository.listStudentAccountsPaginated({ schoolId: 10010002 });

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });
});
