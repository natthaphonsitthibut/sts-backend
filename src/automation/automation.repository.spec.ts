import { AutomationRepository } from './automation.repository';

describe('AutomationRepository', () => {
  it('removes obsolete notifications in the same transaction as a cancelled auto-case', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const repository = new AutomationRepository({} as never);
    await expect(repository.deleteOpenCaseById(77, { query })).resolves.toBe(true);
    expect(query.mock.calls).toHaveLength(2);
    expect(query.mock.calls[1]).toEqual(['DELETE FROM notifications WHERE case_id = $1', [77]]);
  });

  it('keeps notifications when the case has already progressed beyond OPEN', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new AutomationRepository({} as never);
    await expect(repository.deleteOpenCaseById(77, { query })).resolves.toBe(false);
    expect(query.mock.calls).toHaveLength(1);
  });

  it('finds consecutive absent days with the ประวัติการเข้าเรียน day verdict', async () => {
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
    const repository = new AutomationRepository(dataSource as never);

    await repository.listConsecutiveAbsentStudents(3, '2026-06-27');

    expect(queries).toHaveLength(1);
    // No student list = sweep everyone, which the query reads as a NULL scope.
    expect(queries[0].params).toEqual([3, '2026-06-27', null]);
    expect(queries[0].sql).toContain('($3::uuid[] IS NULL OR a.student_uuid = ANY($3::uuid[]))');
    expect(queries[0].sql).toContain('GROUP BY a.student_uuid, a."AttendanceDate"');
    // ลา (4) is not measured; มา/สาย count as attended.
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" <> 4)');
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" IN (1, 3))');
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" IN (1, 3)) = 0');
    expect(queries[0].sql).toContain("a.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain('WITH current_enrollments AS');
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    // A ลา-only day is dropped before the runs are numbered.
    expect(queries[0].sql).toContain(
      'HAVING COUNT(*) FILTER (WHERE a."AttendanceStatus" <> 4) > 0',
    );
    expect(queries[0].sql).toContain('HAVING MAX(run_length) >= $1');
    expect(queries[0].sql).toContain(
      `demo_distribution."RecordedBy" = 'SYSTEM:DEMO_RISK_DISTRIBUTION'`,
    );
    // Days must be consecutive (owner, 2026-10-15); the longest run counts.
    expect(queries[0].sql).toContain(
      'PARTITION BY student_uuid, is_absent_day ORDER BY attendance_date',
    );
  });

  it('narrows the sweep to the students a caller passes', async () => {
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
    const repository = new AutomationRepository(dataSource as never);

    await repository.listConsecutiveAbsentStudents(3, '2026-06-27', undefined, [
      '11111111-1111-4111-8111-111111111111',
    ]);

    expect(queries[0].params).toEqual([3, '2026-06-27', ['11111111-1111-4111-8111-111111111111']]);
  });

  it('does not treat managed draft terms as evaluable legacy attendance', async () => {
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
    const repository = new AutomationRepository(dataSource as never);

    await repository.listEvaluableStudentUuids(
      ['11111111-1111-4111-8111-111111111111'],
      '2026-06-27',
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([['11111111-1111-4111-8111-111111111111'], '2026-06-27']);
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain("attendance.session_kind = 'SUBJECT'");
  });

  it('reuses every active case regardless of its opening reason', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ id: 20, risk_tier: 'LOW' }], affected: 1 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const repository = new AutomationRepository(dataSource as never);

    const result = await repository.findActiveCaseByStudent(
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    );

    expect(result).toEqual({ id: 20, risk_tier: 'LOW' });
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
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    ]);
    expect(queries[0].sql).toContain('status = ANY($1::text[])');
    expect(queries[0].sql).not.toContain('reason_flagged');
    expect(queries[0].sql).toContain('($4::int IS NULL OR school_id = $4)');
    expect(queries[0].sql).toContain('$4::int IS NOT NULL AND student_uuid IS NULL');
  });

  it('shares enrollment row locks with manual case opening in stable order', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new AutomationRepository({} as never);
    const students = ['11111111-1111-4111-8111-111111111111'];
    await repository.lockStudentAbsenceChecks(students, { query });
    expect(query).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('FROM student_term');
    expect(sql).toContain('ORDER BY student_uuid FOR UPDATE');
    expect(params).toEqual([students]);
  });

  it('excludes user and teacher opened cases from automatic cancellation', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new AutomationRepository({} as never);
    await repository.listOpenAbsenceCases({ query });
    await repository.deleteOpenCaseById(77, { query });
    for (const [sql] of query.mock.calls as [string, unknown[]][]) {
      expect(sql).toContain('created_by IS NULL');
      expect(sql).toContain('created_by_teacher_id IS NULL');
      expect(sql).toContain('reason_flagged LIKE ANY(');
    }
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('loads school scope for open absence cases used by legacy auto-cancel fallback', async () => {
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
    const repository = new AutomationRepository(dataSource as never);

    await repository.listOpenAbsenceCases();

    expect(queries[0].sql).toContain('SELECT id, student_name, student_uuid, school_id');
  });

  it('starts the next absence count after the latest resolved case review', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new AutomationRepository({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await repository.listConsecutiveAbsentStudents(3, '2026-08-13');

    expect(queries[0].sql).toContain('resolved_case_baselines');
    expect(queries[0].sql).toContain("tracked_case.status = 'RESOLVED'");
    expect(queries[0].sql).toContain(
      'a."AttendanceDate"::date > COALESCE(baseline.reset_after_date',
    );
  });
});
