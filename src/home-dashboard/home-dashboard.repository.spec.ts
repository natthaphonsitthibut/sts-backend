import { HomeDashboardRepository } from './home-dashboard.repository';

function createRepositoryWithQueryCapture() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ records: [{ count: 0 }], affected: 1 });
    }),
  };
  const dataSource = {
    createQueryRunner: jest.fn(() => queryRunner),
  };

  return {
    queries,
    repository: new HomeDashboardRepository(dataSource as never),
  };
}

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
}

describe('HomeDashboardRepository', () => {
  it('counts students through current enrollment policy', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.countStudents(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home'],
        data_scope: { school_ids: [10010002] },
      },
      {},
    );

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
  });

  it('builds attendance trend from scoped current-enrollment students', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getAttendanceTrend(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home', 'dashboard'],
        data_scope: { school_ids: [10010002] },
      },
      { period: '7_DAYS' },
      '2026-07-01',
      '2026-07-07',
    );

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
    expect(queries[0].sql).toContain('a."AttendanceDate" BETWEEN');
  });

  it('applies grade and room scope to cases through current enrollment', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getCasePipeline(
      {
        id: 1,
        username: 'teacher',
        roles: ['TEACHER'],
        permissions: ['home', 'dashboard'],
        data_scope: { school_ids: [10010002], grade_levels: [7], room_ids: ['2'] },
      },
      {},
    );

    expect(queries[0].sql).toContain('case_scope_student.student_uuid = c.student_uuid');
    expect(queries[0].sql).toContain('case_scope_current.resolution_state');
    expect(queries[0].sql).toContain('case_scope_student."GradeLevelID_Onec"');
    expect(queries[0].sql).toContain('case_scope_student."RoomID_Onec"');
    expect(queries[0].params).toEqual([[10010002], [7], ['2']]);
  });

  it('groups opened and resolved case events by their own event week', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getCaseMovement(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home', 'dashboard'],
        data_scope: { global: true },
      },
      { period: '30_DAYS' },
      '2026-06-15',
      '2026-07-14',
    );

    expect(queries[0].sql).toContain("date_trunc('week', c.created_at)");
    expect(queries[0].sql).toContain("date_trunc('week', c.updated_at)");
    expect(queries[0].sql).not.toContain('COALESCE(c.created_at, c.updated_at)');
  });

  it('counts one student per problem category rather than one row per report', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getFollowUpProblemCategories(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home'],
        data_scope: { global: true },
      },
      {},
    );

    // A child visited three times used to count as three, which read as three
    // affected children on an executive's screen.
    expect(queries[0].sql).toContain('DISTINCT ON (c.student_uuid)');
    expect(queries[0].sql).toContain('ts.follow_up_problem_category_code IS NOT NULL');
    expect(queries[0].sql).toContain('LEFT JOIN follow_up_problem_categories');
    // ASSIST follow-ups carry the same field, so the query is not limited to visits.
    expect(queries[0].sql).not.toContain("t.task_type = 'VISIT'");
  });

  it('reads the newest homeroom observation per student for concern levels', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getTeacherConcernLevels(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home'],
        data_scope: { global: true },
      },
      {},
    );

    expect(queries[0].sql).toContain('DISTINCT ON (observation.person_uuid)');
    expect(queries[0].sql).toContain('classroom_student_comment_concern_levels');
  });

  it('does not expose retired attendance completeness attention items', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getAttentionItems(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home', 'dashboard'],
        data_scope: { global: true },
      },
      { period: '30_DAYS' },
      '2026-07-14',
    );

    expect(queries[0].sql).not.toContain('ATTENDANCE_INCOMPLETE');
    expect(queries[0].sql).not.toContain('/attendance-operations');
  });

  it('ranks high-risk areas deterministically for the requested dimension', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.getHighRiskAreaRanking(
      {
        id: 1,
        username: 'admin',
        roles: ['ADMIN'],
        permissions: ['home'],
        data_scope: { global: true },
      },
      { province: 'เชียงใหม่' },
      'DISTRICT',
    );

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
    expect(queries[0].sql).toContain("profile.risk_tier = 'HIGH'");
    expect(queries[0].sql).toContain('COUNT(DISTINCT s.student_uuid)');
    expect(queries[0].sql).toContain('GROUP BY sc.district');
    expect(queries[0].sql).toContain('sc.district_code AS "areaCode"');
    // No LIMIT on purpose: the province map colours every province from these
    // rows, so cutting the query to a top-N would leave most of the map blank.
    // The order is what has to hold, since the list view takes the first few.
    expect(queries[0].sql).toContain('ORDER BY count DESC, label ASC');
    expect(queries[0].sql).not.toContain('LIMIT');
    expect(queries[0].params).toEqual(['เชียงใหม่']);
  });
});
