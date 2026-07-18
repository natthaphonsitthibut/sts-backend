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

describe('UsersRepository updateUser', () => {
  const baseInput = {
    id: 77,
    username: 'teacher.k',
    firstName: 'ครู',
    lastName: 'ทดสอบ',
    personIdOnec: '1234567890123',
    phone: null,
    email: null,
    affiliation: null,
    lineId: null,
    addressLine: null,
    addressVillageNo: null,
    addressStreet: null,
    addressSoi: null,
    addressTrok: null,
    addressSubDistrict: null,
    addressDistrict: null,
    addressProvince: null,
    addressPostalCode: null,
    addressLatitude: null,
    addressLongitude: null,
    status: 'ACTIVE',
    permissions: [],
    role: 'TEACHER',
    dataScope: {},
    updatedBy: 1,
  };

  function makeExecutor(queries: string[]) {
    return {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve({ rows: [], rowCount: 1 });
      }),
    };
  }

  it('ends the temporary-password lifecycle when an explicit password is set', async () => {
    const queries: string[] = [];
    const repository = new UsersRepository({} as never);

    await repository.updateUser({ ...baseInput, passwordHash: 'hash' }, makeExecutor(queries));

    expect(queries[0]).toContain('must_change_password = FALSE');
    expect(queries[0]).toContain('temporary_password_issued_at = NULL');
    expect(queries[0]).toContain('temporary_password_expires_at = NULL');
  });

  it('leaves the password lifecycle untouched when no password is provided', async () => {
    const queries: string[] = [];
    const repository = new UsersRepository({} as never);

    await repository.updateUser(baseInput, makeExecutor(queries));

    expect(queries[0]).not.toContain('password');
    expect(queries[0]).not.toContain('must_change_password');
  });
});

describe('UsersRepository PII reveal queries', () => {
  function createRepository() {
    const query = jest.fn().mockResolvedValue({ records: [{ found: false }], affected: 1 });
    const repository = new UsersRepository({
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query,
      }),
    } as never);

    return { query, repository };
  }

  it('binds the address reveal TTL to the third SQL parameter', async () => {
    const { query, repository } = createRepository();

    await repository.hasActiveUserAddressReveal(7, 'subject-ref', 300);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('make_interval(secs => $3)'),
      [7, 'subject-ref', 300],
      true,
    );
  });

  it('binds the national-id reveal field group and TTL separately', async () => {
    const { query, repository } = createRepository();

    await repository.hasActiveUserNationalIdReveal(7, 'subject-ref', 300);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('make_interval(secs => $4)'),
      [7, 'subject-ref', 'NATIONAL_ID', 300],
      true,
    );
  });
});
