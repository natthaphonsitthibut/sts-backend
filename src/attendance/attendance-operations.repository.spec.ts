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
  it('synchronizes only real term enrollments and their risk profiles without altering events', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();
    const executor = createExecutorWithQueryCapture(queries);
    const counts = await repository.synchronizeTermEnrollmentLabels(
      10,
      {
        schoolId: 10010002,
        academicYear: 2570,
        semester: 2,
        startsOn: '2027-05-01',
        endsOn: '2027-10-31',
        status: 'DRAFT',
        actorUserId: 5,
      },
      executor,
    );

    expect(counts).toEqual({ enrollments: 0, riskProfiles: 0 });
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain('school_term_id = $1 AND "SchoolID_Onec" = $2');
    expect(queries[0].sql).not.toContain('deleted_at IS NULL');
    expect(queries[1].sql).toContain('enrollment.school_term_id = $1');
    expect(queries[1].sql).toContain('profile.student_uuid = enrollment.student_uuid');
    expect(queries[1].sql).toContain('profile.school_id = $2');
    for (const { sql } of queries) {
      expect(sql).not.toContain('attendance_date');
      expect(sql).not.toContain('AttendanceDate');
      expect(sql).not.toContain('UPDATE attendance');
      expect(sql).not.toContain('UPDATE student_current_enrollment_resolution');
    }
    expect(queries[0].params).toEqual([10, 10010002, 2570, 2, 5]);
  });

  it('creation inserts a new identity and cannot rewrite a natural-key match', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();
    const executor = createExecutorWithQueryCapture(queries);
    await repository.upsertTerm(
      {
        schoolId: 10010002,
        academicYear: 2570,
        semester: 2,
        startsOn: '2027-05-01',
        endsOn: '2027-10-31',
        status: 'DRAFT',
        actorUserId: 5,
      },
      executor,
    );
    expect(queries[0].sql).toContain('INSERT INTO school_terms');
    expect(queries[0].sql).not.toContain('ON CONFLICT');
    expect(queries.map(({ sql }) => sql).join('\n')).not.toContain('UPDATE');
  });

  it('preflights persisted unique constraints including retained enrollment identities', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();
    await repository.findTermWriteConflict(
      10,
      {
        schoolId: 10010002,
        academicYear: 2570,
        semester: 2,
        startsOn: '2027-05-01',
        endsOn: '2027-10-31',
        status: 'ACTIVE',
        actorUserId: 5,
      },
      createExecutorWithQueryCapture(queries),
    );
    expect(queries[0].sql).toContain("THEN 'TERM_IDENTITY'");
    expect(queries[0].sql).toContain("THEN 'ACTIVE_TERM'");
    expect(queries[0].sql).toContain("THEN 'ENROLLMENT_IDENTITY'");
    expect(queries[0].sql).toContain("THEN 'STUDENT_NUMBER'");
    expect(queries[0].sql).toContain('linked.school_term_id = $1');
    expect(queries[0].params).toEqual([10, 10010002, 2570, 2, 'ACTIVE']);
  });

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
