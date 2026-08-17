import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
  it('keeps task-link audit ids separate from OTP verification', async () => {
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
        otpVerified: 0,
        createdBy: 460,
      },
      executor,
    );

    const [sql, params] = executor.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(
      /otp_verified,[\s\S]*created_by,[\s\S]*updated_by[\s\S]*\$15,[\s\S]*\$16,[\s\S]*\$16/,
    );
    expect(params[9]).toBe(42);
    expect(params[14]).toBe(0);
    expect(params[15]).toBe(460);
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
      ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND'],
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
    await repository.listPublicCaseFollowUpHistory(41);

    const activeLinkQuery = queries[0].sql;
    expect(activeLinkQuery).toContain('current_assignee_teacher.first_name');
    expect(activeLinkQuery).toContain('AS current_assignee_name');

    const roundsQuery = queries[1].sql;
    expect(roundsQuery).toContain("WHEN tl.status = 'ACTIVE' THEN COALESCE(");
    expect(roundsQuery).toContain('current_assignee_teacher.first_name');
    expect(roundsQuery).toContain('ELSE tl.assigned_to_name');

    const historyQuery = queries[2].sql;
    expect(historyQuery).toContain('link.assigned_to_name');
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
              school_day_count: 20,
              weighted_absence_days: '6.25',
              weighted_attendance_percent: '68.8',
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
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('LEFT JOIN student_risk_profiles profile');
    expect(queries[0].sql).toContain('profile.term_absent_days');
    expect(queries[0].sql).toContain('profile.absence_reset_after_date');
    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('latest_case.id IS NOT NULL');
    expect(queries[0].sql).toContain("COUNT(*) FILTER (WHERE latest_case_status = 'OPEN')");
    expect(queries[0].sql).not.toContain('JOIN base_students case_student');
    expect(queries[0].sql).not.toContain('FROM attendance a');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = ANY($1::int[])');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = $2');
    expect(queries[0].sql).toContain('risk_tier = $4');
    expect(queries[1].sql).toContain('risk_tier = $4');
    expect(queries[2].sql).toContain(
      'ORDER BY weighted_attendance_percent ASC NULLS LAST, risk_severity DESC, student_name ASC',
    );
    expect(queries[2].sql).toContain('LIMIT $5 OFFSET $6');
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
      },
      { searchTerm: 'เด็ก_100%' },
      { highAbsentDays: 3 },
    );
    expect(queries[0].params).toEqual(['%เด็ก\\_100\\%%']);
    expect(queries[0].sql).toContain("ESCAPE '\\'");
  });

  it('fails closed for own-only actors on the risk dashboard', async () => {
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
          data_scope: { own_only: true },
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
    });
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('claims case SLA warnings at the 80 percent window only once', async () => {
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
    const now = new Date('2026-07-09T00:00:00.000Z');

    await repository.claimCaseSlaWarnings(now);

    expect(queries[0].params).toEqual([now.toISOString()]);
    expect(queries[0].sql).toContain('SET sla_warning_notified_at = now()');
    expect(queries[0].sql).toContain('c.sla_warning_notified_at IS NULL');
    expect(queries[0].sql).toContain('INSERT INTO audit_log');
    expect(queries[0].sql).toContain('CASE_SLA_WARNING');
    expect(queries[0].sql).toContain(
      '$1::timestamptz >= c.created_at + ((c.sla_due_at - c.created_at) * 0.8)',
    );
    expect(queries[0].sql).toContain('$1::timestamptz < c.sla_due_at');
  });

  it('claims breached case SLA rows without requiring a prior warning', async () => {
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
    const now = new Date('2026-07-11T00:00:00.000Z');

    await repository.claimCaseSlaBreaches(now);

    expect(queries[0].params).toEqual([now.toISOString()]);
    expect(queries[0].sql).toContain('SET sla_breached_notified_at = now()');
    expect(queries[0].sql).toContain('c.sla_breached_notified_at IS NULL');
    expect(queries[0].sql).toContain('INSERT INTO audit_log');
    expect(queries[0].sql).toContain('CASE_SLA_BREACHED');
    expect(queries[0].sql).toContain('c.sla_due_at < $1::timestamptz');
    expect(queries[0].sql).not.toContain('sla_warning_notified_at IS NOT NULL');
  });

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
});
