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

  it('filters student list by canonical student status code', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({ studentStatusCode: 20, enrollmentState: 'all' });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $1');
    expect(queries[1]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $1');
  });

  it('filters student filter options through current enrollment policy by default', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.getStudentFilterOptions({});

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });

  it('filters student filter options by canonical student status code', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.getStudentFilterOptions({ studentStatusCode: 10 });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec")');
    expect(queries[1]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec")');
  });

  it('lists student attendance history from daily rows only', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listAttendanceByStudentId('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("AND a.session_kind = 'DAILY'");
  });

  it('derives the linked account lifecycle instead of exposing raw ACTIVE status', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findStudentAccountByPersonUuid('10000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("THEN 'TEMP_PASSWORD_EXPIRED'");
    expect(queries[0]).toContain('temporary_password_expires_at <= NOW()');
  });

  it('loads the persisted risk tier with student detail and defaults missing profiles to normal', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findStudentById('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      'LEFT JOIN student_risk_profiles risk ON risk.student_uuid = s.student_uuid',
    );
    expect(queries[0]).toContain("COALESCE(risk.risk_tier, 'NORMAL') as risk_tier");
  });

  it('scopes the legacy case-by-name lookup through the linked enrollment', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findCasesByStudentName('เด็ก ทดสอบ', { school_ids: [10010002] });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('INNER JOIN student_term s ON s.student_uuid = c.student_uuid');
    expect(queries[0]).toContain('s."SchoolID_Onec" = ANY($2::int[])');
  });

  it('loads student case history by stable UUID', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findCasesByStudentId('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('WHERE student_uuid = $1');
    expect(queries[0]).not.toContain('student_name =');
  });
});
