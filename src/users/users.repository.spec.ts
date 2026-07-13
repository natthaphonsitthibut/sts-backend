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

describe('UsersRepository user list queries', () => {
  it('filters rows by lifecycle status without narrowing summary counts', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const repository = new UsersRepository({
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          if (calls.length === 1) {
            return Promise.resolve({ records: [{ count: 1 }], affected: 1 });
          }
          if (calls.length === 2) {
            return Promise.resolve({ records: [{ status: 'ACTIVE', count: 1 }], affected: 1 });
          }
          return Promise.resolve({ records: [], affected: 0 });
        }),
      }),
    } as never);

    await repository.listUsersPaginated({
      actorId: 1,
      actorRole: 'ADMIN',
      actorRank: 5,
      accountStatus: 'ACTIVE',
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].params).toContain('ACTIVE');
    expect(calls[2].params).toContain('ACTIVE');
    expect(calls[0].sql).toContain(
      "WHEN u.must_change_password IS TRUE THEN 'PENDING_FIRST_LOGIN'",
    );
    expect(calls[2].sql).toContain(
      "WHEN u.must_change_password IS TRUE THEN 'PENDING_FIRST_LOGIN'",
    );
    expect(calls[1].params).not.toContain('ACTIVE');
    expect(calls[1].sql).not.toMatch(/END\s*\)\s*=\s*\$/);
  });
});
