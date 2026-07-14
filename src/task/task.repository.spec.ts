import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
  it('loads timetable slots for task-link validation with grade labels', async () => {
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

    await repository.listTimetableSlotsForTaskLink([11, 12]);

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([[11, 12]]);
    expect(queries[0].sql).toContain('FROM timetable_slots ts');
    expect(queries[0].sql).toContain('JOIN grade_levels gl ON gl.id = ts.grade_level_id');
    expect(queries[0].sql).toContain('ts.id = ANY($1::bigint[])');
    expect(queries[0].sql).toContain('ts.deleted_at IS NULL');
  });

  it('inserts timetable slot bindings for task links', async () => {
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

    await repository.insertTaskLinkTimetableSlots('link-1', [11, 12], 7);

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(['link-1', [11, 12], 7]);
    expect(queries[0].sql).toContain('INSERT INTO task_link_timetable_slots');
    expect(queries[0].sql).toContain('FROM unnest($2::bigint[]) AS slot_id');
  });

  it('lists attendance task history from daily rows only when no link id is passed', async () => {
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

    await repository.listTaskHistory('2026-07-07', 'ม.1', '1', 10010002);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("AND a.session_kind = 'DAILY'");
  });

  it('lists subject attendance history only for slots bound to the link', async () => {
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

    await repository.listTaskHistory('2026-07-07', 'ม.1', '1', 10010002, 'link-1');

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('task_link_timetable_slots');
    expect(queries[0].sql).toContain(
      'LEFT JOIN attendance_sessions sess ON sess.id = a.session_id',
    );
    expect(queries[0].sql).toContain("a.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain('link_slot.timetable_slot_id = sess.timetable_slot_id');
    expect(queries[0].params).toEqual(['2026-07-07', 'ม.1', 1, 10010002, 'link-1']);
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
      ['OPEN', 'IN_PROGRESS', 'REPORTED_UP', 'PENDING_REVIEW'],
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

  it('lists risk dashboard students with actor scope, risk filter, and server sorting', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (queries.length === 1) {
          return {
            records: [{ total_count: 3, HIGH: 1, MEDIUM: 1, LOW: 0, WATCH: 1, NORMAL: 0 }],
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
              absent_days: 6,
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
        riskTier: 'HIGH',
        schoolId: 101,
        searchTerm: 'เด็ก',
        page: 2,
        limit: 10,
        sortBy: 'attendance',
        sortDirection: 'asc',
      },
      {
        lowConsecutiveAbsentDays: 3,
        mediumConsecutiveAbsentDays: 5,
        highConsecutiveAbsentDays: 7,
        watchProgressRatio: 0.7,
        lowAttendancePercent: 95,
        mediumAttendancePercent: 90,
        highAttendancePercent: 80,
        lateWeight: 0.25,
        subjectLateWindowDays: 30,
        subjectLateWatchCount: 5,
      },
    );

    expect(result.totalCount).toBe(1);
    expect(result.summary.HIGH).toBe(1);
    expect(result.summary.MEDIUM).toBe(1);
    expect(result.summary.WATCH).toBe(1);
    expect(result.rows[0].student_uuid).toBe('00000000-0000-4000-8000-000000000001');
    expect(queries).toHaveLength(3);
    expect(queries[0].params).toEqual([[101], 101, '%เด็ก%']);
    expect(queries[1].params).toEqual([[101], 101, '%เด็ก%', 'HIGH']);
    expect(queries[2].params).toEqual([[101], 101, '%เด็ก%', 'HIGH', 10, 10]);
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('LEFT JOIN student_risk_profiles profile');
    expect(queries[0].sql).not.toContain('FROM attendance a');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = ANY($1::int[])');
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = $2');
    expect(queries[0].sql).not.toContain('risk_tier = $4');
    expect(queries[1].sql).toContain('risk_tier = $4');
    expect(queries[2].sql).toContain(
      'ORDER BY weighted_attendance_percent ASC NULLS LAST, risk_severity DESC, student_name ASC',
    );
    expect(queries[2].sql).toContain('LIMIT $5 OFFSET $6');
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
        {
          lowConsecutiveAbsentDays: 3,
          mediumConsecutiveAbsentDays: 5,
          highConsecutiveAbsentDays: 7,
          watchProgressRatio: 0.7,
          lowAttendancePercent: 95,
          mediumAttendancePercent: 90,
          highAttendancePercent: 80,
          lateWeight: 0.25,
          subjectLateWindowDays: 30,
          subjectLateWatchCount: 5,
        },
      ),
    ).resolves.toEqual({
      rows: [],
      totalCount: 0,
      summary: { HIGH: 0, MEDIUM: 0, LOW: 0, WATCH: 0, NORMAL: 0 },
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
});
