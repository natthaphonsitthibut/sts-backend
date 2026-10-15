import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
  it('reads live links with a fresh query after obtaining the scoped case lock', async () => {
    const executor = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 123, status: 'IN_PROGRESS', workflow_phase_code: 'FOLLOW_UP' }],
        })
        .mockResolvedValueOnce({ rows: [{ has_live_assignment: true }] }),
    };
    const repository = new TaskRepository({} as never, undefined as never, undefined as never);
    const actor = {
      id: 7,
      username: 'reviewer',
      roles: ['ADMIN'],
      permissions: ['case:assign'],
      data_scope: { school_ids: [10010002] },
    };
    await expect(
      repository.lockCaseForVisitAssignment(123, actor, executor),
    ).resolves.toMatchObject({
      id: 123,
      has_live_assignment: true,
    });
    expect(executor.query.mock.calls[0]).toEqual([
      expect.stringMatching(/c\.school_id = ANY\(\$2::int\[\]\)[\s\S]*FOR UPDATE OF c/),
      [123, [10010002]],
    ]);
    expect(executor.query.mock.calls[1]).toEqual([
      expect.stringMatching(/active_task\.case_id = \$1/),
      [123],
    ]);
  });

  it('changes assignment status and phase together without shifting the school scope incorrectly', async () => {
    const executor = { query: jest.fn().mockResolvedValue([]) };
    const repository = new TaskRepository({} as never, undefined as never, undefined as never);
    await repository.updateCaseStatus(
      123,
      'IN_PROGRESS',
      executor,
      {
        id: 7,
        username: 'reviewer',
        roles: ['ADMIN'],
        permissions: ['case:assign'],
        data_scope: { school_ids: [10010002] },
      },
      'FOLLOW_UP',
    );
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(/workflow_phase_code = \$3[\s\S]*c\.school_id = ANY\(\$4::int\[\]\)/),
      ['IN_PROGRESS', 123, 'FOLLOW_UP', [10010002]],
    );
  });

  it('persists task links without legacy OTP columns', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = new TaskRepository({} as never, undefined as never, undefined as never);

    await repository.createTaskLink(
      {
        linkId: '10000000-0000-4000-8000-000000000001',
        taskId: '20000000-0000-4000-8000-000000000002',
        tokenHash: 'token-hash',
        tokenEncrypted: 'encrypted-token',
        assignedToName: 'ครู ทดสอบ',
        assignedToFirstName: null,
        assignedToLastName: null,
        assignedToPhone: null,
        assignedToEmail: 'teacher@example.test',
        assignedTeacherId: 42,
        expiresAt: '2026-08-14T10:00:00.000Z',
        opensAt: '2026-08-13T10:00:00.000Z',
        subject: null,
        assignmentNote: 'ติดตามที่บ้าน',
        subjectId: null,
        createdBy: 460,
      },
      executor,
    );

    const [sql, params] = executor.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/otp_/i);
    expect(sql).toMatch(/created_by,[\s\S]*updated_by,[\s\S]*opens_at/);
    expect(params).toHaveLength(16);
    expect(params[9]).toBe(42);
    expect(params[14]).toBe(460);
    expect(params[15]).toBe('2026-08-13T10:00:00.000Z');
  });

  it('checks visit attachments against the authenticated case scope', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [{ allowed: true }], affected: 1 }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await expect(
      repository.canAccessVisitAttachment('/uploads/visit-attachments/report.jpg', {
        id: 7,
        username: 'reviewer',
        roles: ['ADMIN'],
        permissions: ['students'],
        data_scope: { school_ids: [10010004] },
      }),
    ).resolves.toBe(true);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /submission\.photo_paths::jsonb[\s\S]*c\.school_id = ANY\(\$2::int\[\]\)/,
      ),
      ['/uploads/visit-attachments/report.jpg', [10010004]],
      true,
    );
  });

  it('falls back to the case enrollment for missing task grade and room', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.findTaskChainTask('task-id');
    await repository.findLinkDetailById('link-id');

    expect(queries[0].sql).toContain('ON case_enrollment.student_uuid = c.student_uuid');
    expect(queries[0].sql).toContain(`NULLIF(TRIM(t.target_grade), '')`);
    expect(queries[0].sql).toContain('case_enrollment."RoomID_Onec"::text');
    expect(queries[1].sql).toContain('ON link_enrollment.student_uuid = c.student_uuid');
    expect(queries[1].sql).toContain('link_grade.label');
    expect(queries[1].sql).toContain('link_enrollment."RoomID_Onec"::text');
  });

  it('locks and scopes the authoritative student row before manual case creation', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      }),
    };
    const repository = new TaskRepository({} as never, undefined as never, undefined as never);

    await repository.findStudentForCaseCreation(
      '00000000-0000-4000-8000-000000000001',
      {
        id: 7,
        username: 'director',
        roles: ['DIRECTOR'],
        permissions: ['dashboard'],
        data_scope: { school_ids: [101], grade_levels: [6], room_ids: ['2'] },
      },
      executor as never,
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('FOR UPDATE OF student');
    expect(queries[0].sql).toContain('student."SchoolID_Onec" = ANY($2::int[])');
    expect(queries[0].sql).toContain('student."GradeLevelID_Onec" = ANY($3::int[])');
    expect(queries[0].sql).toContain('student."RoomID_Onec"::text = ANY($4::text[])');
    expect(queries[0].params).toEqual(['00000000-0000-4000-8000-000000000001', [101], [6], ['2']]);
  });

  it('counts distinct active-case students within the actor scope', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: '2' }], affected: 1 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    const count = await repository.countAtRiskStudents({
      id: 7,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['view-dashboard'],
      data_scope: {
        school_ids: [101],
        grade_levels: [6],
        own_only: true,
      },
    });

    expect(count).toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      [
        'OPEN',
        'IN_PROGRESS',
        'PENDING_REVIEW',
        'STUDENT_NOT_FOUND',
        'AWAITING_REFERRAL',
        'AWAITING_REFERRAL_OUTCOME',
        'REFERRAL_NOT_SUCCEEDED',
      ],
      [101],
      [6],
      7,
    ]);
    expect(queries[0].sql).toContain('count(DISTINCT CASE');
    expect(queries[0].sql).toContain('c.status = ANY($1::text[])');
    expect(queries[0].sql).toContain('c.school_id = ANY($2::int[])');
    expect(queries[0].sql).toContain('case_scope_student."GradeLevelID_Onec" = ANY($3::int[])');
    expect(queries[0].sql).toContain('c.created_by = $4');
    expect(queries[0].sql).toContain('c.deleted_at IS NULL');
  });

  it('applies every selected school area filter to cases and status counts', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: '0' }], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    await repository.listCasesWithActiveLinks(undefined, {
      province: 'ขอนแก่น',
      district: 'เมืองขอนแก่น',
      subDistrict: 'ในเมือง',
      page: 1,
      limit: 20,
    });

    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.sql).toContain('area_school.province = $1');
      expect(query.sql).toContain('area_school.district = $2');
      expect(query.sql).toContain('area_school.sub_district = $3');
      expect(query.params?.slice(0, 3)).toEqual(['ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง']);
    }
  });

  it('keeps the latest assignee visible after the active task link is completed', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: '0' }], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.listCasesWithActiveLinks(undefined, { page: 1, limit: 20 });

    const listQuery = queries[1].sql;
    expect(listQuery).toContain("WHEN c.status <> 'RESOLVED' THEN COALESCE(");
    expect(listQuery).toContain('active_assignee_teacher.first_name');
    expect(listQuery).toContain('latest_assignee_teacher.first_name');
    expect(listQuery).toContain('ELSE latest_link.assigned_to_name');
    expect(listQuery).toContain('LEFT JOIN LATERAL (\n        SELECT latest_assignee_link.*');
    expect(listQuery).toContain('latest_assignee_link.deleted_at IS NULL');
    expect(listQuery).not.toContain("latest_assignee_link.status = 'ACTIVE'");
  });

  it('uses current teacher names only for live assignments and keeps history snapshots', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.findTaskLinkByTokenHash('token-hash');
    await repository.listTasksByCase(41);
    await repository.listStudentFollowUpHistory(41, 5, { publicCase: true });

    const activeLinkQuery = queries[0].sql;
    expect(activeLinkQuery).toContain('current_assignee_teacher.first_name');
    expect(activeLinkQuery).toContain('AS current_assignee_name');

    const roundsQuery = queries[1].sql;
    expect(roundsQuery).toContain("WHEN tl.status = 'ACTIVE' THEN COALESCE(");
    expect(roundsQuery).toContain('current_assignee_teacher.first_name');
    expect(roundsQuery).toContain('ELSE tl.assigned_to_name');

    const historyQuery = queries[2].sql;
    expect(historyQuery).toContain('link.assigned_to_name');
    // The student's visits from every case, matched through the person.
    expect(historyQuery).toContain('sibling_term.person_uuid = current_term.person_uuid');
    expect(historyQuery).not.toContain('current_assignee_teacher');
  });

  it('returns a scoped student photo URL without exposing its storage key', async () => {
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string) => {
        if (sql.includes('SELECT count(*)')) {
          return { records: [{ count: '1' }], affected: 1 };
        }
        if (sql.includes('student_match.photo_storage_key')) {
          return {
            records: [
              {
                id: 41,
                student_id: '00000000-0000-4000-8000-000000000041',
                student_photo_storage_key: 'student-photos/person/profile.webp',
                student_photo_updated_at: '2026-08-10T06:30:00.000Z',
                active_link_token_encrypted: null,
              },
            ],
            affected: 1,
          };
        }
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    const result = await repository.listCasesWithActiveLinks(undefined, { page: 1, limit: 20 });

    expect(result.rows[0]).toMatchObject({
      student_photo_url:
        '/api/students/00000000-0000-4000-8000-000000000041/photo?v=2026-08-10T06%3A30%3A00.000Z',
    });
    expect(result.rows[0]).not.toHaveProperty('student_photo_storage_key');
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'LEFT JOIN student_person person ON person.person_uuid = s.person_uuid',
      ),
      expect.any(Array),
      true,
    );
  });

  it('lists risk dashboard students with actor scope, risk filter, and server sorting', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return {
            records: [{ total_count: 3, HIGH: 1, WATCH: 1, NORMAL: 1 }],
            affected: 1,
          };
        }
        if (queries.length === 2) {
          return { records: [{ count: 1 }], affected: 1 };
        }
        return {
          records: [
            {
              student_uuid: '00000000-0000-4000-8000-000000000001',
              student_name: 'เด็ก เสี่ยง',
              school_id: 101,
              school_name: 'โรงเรียนทดสอบ',
              grade: 'ม.1',
              room: '1',
              consecutive_absent_days: 5,
              absent_days_since_case_reset: 6,
              term_absent_days: 9,
              absence_reset_after_date: '2026-08-01',
              late_count: 1,
              recorded_day_count: 20,
              attendance_rate_percent: '68.8',
              risk_tier: 'HIGH',
              risk_score: '1.2500',
              open_case_count: 1,
              latest_case_at: null,
            },
          ],
          affected: 1,
        };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    const result = await repository.listRiskDashboardStudents(
      {
        id: 7,
        username: 'dashboard-admin',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['dashboard'],
        data_scope: { school_ids: [101] },
      },
      {
        studentGroup: 'RISK',
        riskTier: 'HIGH',
        schoolId: 101,
        searchTerm: 'เด็ก',
        page: 2,
        limit: 10,
        sortBy: 'attendance',
        sortDirection: 'asc',
      },
      { highAbsentDays: 3 },
    );

    expect(result.totalCount).toBe(1);
    expect(result.summary.HIGH).toBe(1);
    expect(result.summary.WATCH).toBe(1);
    expect(result.rows[0].student_uuid).toBe('00000000-0000-4000-8000-000000000001');
    expect(queries).toHaveLength(3);
    expect(queries[0].params).toEqual([[101], 101, '%เด็ก%', 'HIGH']);
    expect(queries[1].params).toEqual([[101], 101, '%เด็ก%', 'HIGH']);
    expect(queries[2].params).toEqual([[101], 101, '%เด็ก%', 'HIGH', 10, 10]);
    expect(queries[0].sql).not.toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('s.deleted_at IS NULL');
    expect(queries[0].sql).toContain('s."AcademicYear_Onec" AS academic_year');
    expect(queries[0].sql).toContain('LEFT JOIN student_risk_profiles profile');
    expect(queries[0].sql).toContain('profile.term_absent_days');
    expect(queries[0].sql).toContain('profile.absence_reset_after_date');
    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('JOIN classroom_student_problem_categories category');
    expect(queries[0].sql).toContain('latest_comment.problem_category_label');
    expect(queries[0].sql).toContain('latest_case.id IS NOT NULL');
    expect(queries[0].sql).toContain("COUNT(*) FILTER (WHERE latest_case_status = 'OPEN')");
    expect(queries[0].sql).not.toContain('JOIN base_students case_student');
    expect(queries[0].sql).not.toContain('FROM attendance a');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = ANY($1::int[])');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = $2');
    expect(queries[0].sql).toContain('risk_tier = $4');
    expect(queries[1].sql).toContain('risk_tier = $4');
    expect(queries[2].sql).toContain(
      'ORDER BY attendance_rate_percent ASC NULLS LAST, risk_severity DESC, student_name ASC',
    );
    expect(queries[2].sql).toContain('LIMIT $5 OFFSET $6');
  });

  it('sorts the watchlist by problem category and selects only prioritized signals', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return { records: [{ total_count: 0, HIGH: 0, WATCH: 0, NORMAL: 0 }], affected: 1 };
        }
        if (queries.length === 2) return { records: [{ count: 0 }], affected: 1 };
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.listRiskDashboardStudents(
      {
        id: 1,
        username: 'dashboard-admin',
        roles: ['ADMIN'],
        permissions: ['dashboard', 'students'],
        data_scope: { global: true },
      },
      { studentGroup: 'WATCHLIST', page: 1, limit: 20, sortBy: 'problemCategory' },
      { highAbsentDays: 3 },
    );

    // The newest observation is shown, whatever its level. Which levels put
    // a student on the list is no longer baked into the lateral — every level is
    // read so all three can be counted, and the default WATCH/CONCERN pair is
    // applied afterwards as a parameter.
    expect(queries[0].sql).toContain('latest_comment.problem_category_label');
    expect(queries[0].sql).toContain('latest_comment.problem_description');
    expect(queries[0].sql).not.toContain("comment.concern_level_code IN ('WATCH', 'CONCERN')");
    // No level filter unless one is asked for: the three level counts have to
    // add up to the rows on screen.
    expect(queries[1].sql).not.toContain('concern_level_code =');
    expect(queries[0].sql).toContain('ORDER BY comment.created_at DESC, comment.id DESC');
    expect(queries[0].sql).not.toContain('concern_level.sort_order DESC, comment.created_at');
    expect(queries[2].sql).toContain(
      'ORDER BY problem_category_label DESC NULLS LAST, student_name ASC',
    );
  });

  it('builds a valid unfiltered dashboard query and escapes literal search wildcards', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return { records: [{ total_count: 0, HIGH: 0, WATCH: 0, NORMAL: 0 }], affected: 1 };
        }
        if (queries.length === 2) return { records: [{ count: 0 }], affected: 1 };
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.listRiskDashboardStudents(
      {
        id: 1,
        username: 'national-admin',
        roles: ['ADMIN'],
        permissions: ['dashboard'],
        data_scope: { global: true },
      },
      {},
      { highAbsentDays: 3 },
    );
    expect(queries[0].sql).not.toMatch(/\bWHERE\s*\)/);
    expect(queries[0].sql).not.toContain('WHERE \n');

    queries.length = 0;
    await repository.listRiskDashboardStudents(
      {
        id: 1,
        username: 'national-admin',
        roles: ['ADMIN'],
        permissions: ['dashboard'],
        data_scope: { global: true },
      },
      { searchTerm: 'เด็ก_100%' },
      { highAbsentDays: 3 },
    );
    expect(queries[0].params).toEqual(['%เด็ก\\_100\\%%']);
    expect(queries[0].sql).toContain("ESCAPE '\\'");
    expect(queries[0].sql).not.toContain('s."PersonID_Onec" ILIKE');
  });

  it.each([undefined, {}, { own_only: true }, { school_ids: [] }])(
    'fails closed for missing or denied dashboard scope %j',
    async (scope) => {
      const queryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
      };
      const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
      const repository = new TaskRepository(
        dataSource as never,
        undefined as never,
        undefined as never,
      );

      await expect(
        repository.listRiskDashboardStudents(
          {
            id: 7,
            username: 'student-like',
            roles: ['STUDENT'],
            permissions: ['dashboard'],
            data_scope: scope,
          },
          {},
          { highAbsentDays: 3 },
        ),
      ).resolves.toEqual({
        rows: [],
        totalCount: 0,
        summary: { HIGH: 0, WATCH: 0, NORMAL: 0 },
        caseStatusSummary: {
          OPEN: 0,
          IN_PROGRESS: 0,
          PENDING_REVIEW: 0,
          STUDENT_NOT_FOUND: 0,
        },
        concernLevelSummary: { NOTE: 0, WATCH: 0, CONCERN: 0 },
      });
      expect(queryRunner.query).not.toHaveBeenCalled();
    },
  );

  it('transitions a case from an active tracking status only', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [{ id: 10 }], rowCount: 1 };
      }),
    };
    const repository = new TaskRepository({} as never, undefined as never, undefined as never);

    await expect(
      repository.updateCaseAfterSubmission(
        {
          caseId: 10,
          nextStatus: 'PENDING_REVIEW',
          nextSummary: 'รายงานการติดตาม',
          updatedStudentAddress: null,
          updatedAddressLine: null,
          updatedAddressProvince: null,
          updatedAddressDistrict: null,
          updatedAddressSubDistrict: null,
          updatedPostalCode: null,
          updatedLat: null,
          updatedLng: null,
          clearMissingCoordinates: false,
        },
        executor as never,
      ),
    ).resolves.toBe(true);

    expect(queries[0].sql).toContain("status IN ('OPEN', 'IN_PROGRESS')");
    expect(queries[0].sql).toContain('RETURNING id');
    expect(queries[0].params).toEqual([
      'PENDING_REVIEW',
      'รายงานการติดตาม',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      10,
      null,
    ]);
  });

  it('resolves a human reviewer from the persisted user foreign key', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    await repository.listCaseReviews(1254);

    expect(queries[0].params).toEqual([1254]);
    expect(queries[0].sql).toContain(
      'LEFT JOIN users actor ON actor.id = review.source_actor_user_id',
    );
    expect(queries[0].sql).toContain('AS reviewer_display');
    expect(queries[0].sql).not.toContain('review.*');
    expect(queries[0].sql).not.toContain('review.created_by');
    expect(queries[0].sql).not.toContain('review.source_actor_user_id,');
  });

  it('loads system risk signals separately from human reviews', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new TaskRepository(
      dataSource as never,
      undefined as never,
      undefined as never,
    );

    await repository.listCaseRiskSignals(1254);

    expect(queries[0].params).toEqual([1254]);
    expect(queries[0].sql).toContain('FROM case_risk_signals');
    expect(queries[0].sql).toContain('ORDER BY detected_at DESC');
    expect(queries[0].sql).not.toContain('case_reviews');
  });

  it('loads repeat prefill from the latest prior VISIT with an explicit allowlist', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );

    await repository.findRepeatVisitPrefill(1254, '00000000-0000-4000-8000-000000000001');

    expect(queries[0].params).toEqual([1254, '00000000-0000-4000-8000-000000000001']);
    expect(queries[0].sql).toContain("task.task_type = 'VISIT'");
    expect(queries[0].sql).toContain('source_task_id <> $2');
    expect(queries[0].sql).toContain('contact_person_name');
    expect(queries[0].sql).toContain('residence_environment_codes');
    expect(queries[0].sql).toContain('task_submission_guardian_types');
    expect(queries[0].sql).toContain('AS guardian_type_codes');
    expect(queries[0].sql).not.toContain('photo_paths');
    expect(queries[0].sql).not.toContain('task_execution_outcome_code');
    expect(queries[0].sql).not.toContain('case_referrals');
  });

  it('scopes follow-up aggregate queries through the authoritative case school', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: jest.fn(() => queryRunner) } as never,
      undefined as never,
      undefined as never,
    );
    const actor = {
      id: 7,
      username: 'director',
      roles: ['DIRECTOR'],
      permissions: ['dashboard'],
      data_scope: { school_ids: [101] },
    };

    await repository.getFollowUpOutcomeAggregate(actor);
    await repository.getReferralAggregate(actor);

    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toContain('c.school_id = ANY($1::int[])');
    expect(queries[1].sql).toContain('c.school_id = ANY($1::int[])');
    expect(queries[0].params).toEqual([[101]]);
    expect(queries[1].params).toEqual([[101]]);
    expect(queries[0].sql).not.toContain('student_name');
    expect(queries[1].sql).not.toContain('student_name');
  });
  it('applies staff school, grade, room and own scope to every history case', async () => {
    const queryRunner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: () => queryRunner } as never,
      undefined as never,
      undefined as never,
    );
    await repository.listStudentFollowUpHistory(41, 5, {
      actor: {
        id: 7,
        data_scope: { school_ids: [101], grade_levels: [3], room_ids: [2], own_only: true },
      },
    });
    const [sql, params] = queryRunner.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('history_case.school_id = ANY($3::int[])');
    expect(sql).toContain('history_case.created_by = $6');
    expect(params).toEqual([41, 5, [101], [3], [2], 7]);
  });

  it('confines public history to the token case school and fails closed for unconfigured staff scope', async () => {
    const queryRunner = {
      connect: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const repository = new TaskRepository(
      { createQueryRunner: () => queryRunner } as never,
      undefined as never,
      undefined as never,
    );
    await repository.listStudentFollowUpHistory(41, 5, { publicCase: true });
    const publicCall = queryRunner.query.mock.calls[0] as [string];
    expect(publicCall[0]).toContain('history_case.school_id = (');
    await repository.listStudentFollowUpHistory(41, 5, { actor: { id: 7 } });
    const staffCall = queryRunner.query.mock.calls[1] as [string];
    expect(staffCall[0]).toContain('AND (1=0)');
  });

  it.each(['SENT', 'FAILED'])(
    'returns completed %s instead of SENDING after a rejected LINE claim',
    async (status) => {
      const queryRunner = {
        connect: jest.fn(),
        release: jest.fn(),
        query: jest
          .fn()
          .mockResolvedValueOnce({ records: [], affected: 0 })
          .mockResolvedValueOnce({
            records: [
              {
                line_delivery_request_id: 'request-id',
                line_delivery_teacher_id: '41',
                line_delivery_status: status,
                line_delivery_failure_code: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
              },
            ],
            affected: 1,
          }),
      };
      const repository = new TaskRepository(
        { createQueryRunner: () => queryRunner } as never,
        undefined as never,
        undefined as never,
      );
      await expect(repository.claimRoundLine('link-id', '41', 'request-id', 7)).resolves.toEqual({
        kind: 'completed',
        status,
        failure_code: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
      });
    },
  );
});
