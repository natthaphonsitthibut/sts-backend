import { AutomationRepository } from './automation.repository';

describe('AutomationRepository', () => {
  it('calculates consecutive absence streaks by distinct attendance date', async () => {
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
    expect(queries[0].params).toEqual([3, '2026-06-27']);
    expect(queries[0].sql).toContain('configured_day_flags');
    expect(queries[0].sql).toContain('configured_streak_boundaries');
    expect(queries[0].sql).toContain('session.recorded_count = session.expected_roster_count');
    expect(queries[0].sql).toContain('GROUP BY a.student_uuid, a."AttendanceDate"');
    expect(queries[0].sql).toContain('BOOL_AND(a."AttendanceStatus" = 2)');
    expect(queries[0].sql).toContain("AND a.session_kind = 'DAILY'");
    expect(queries[0].sql).toContain('fallback_absence_streak');
    expect(queries[0].sql).toContain('FROM school_terms managed_term');
    expect(queries[0].sql).toContain(
      'managed_term.academic_year = current_enrollment."AcademicYear_Onec"',
    );
    expect(queries[0].sql).not.toContain('ORDER BY "AttendanceDate" DESC, "AttendanceID" DESC');
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
      3,
      '2026-06-27',
    );

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('fallback_evaluable');
    expect(queries[0].sql).toContain('FROM school_terms managed_term');
    expect(queries[0].sql).toContain('managed_term.semester = current_enrollment."Semester_Onec"');
  });

  it('deduplicates against active absence cases, not only OPEN cases', async () => {
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

    const result = await repository.findActiveAbsenceCaseByStudent(
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    );

    expect(result).toEqual({ id: 20, risk_tier: 'LOW' });
    expect(queries[0].params).toEqual([
      ['OPEN', 'IN_PROGRESS', 'REPORTED_UP', 'PENDING_REVIEW'],
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    ]);
    expect(queries[0].sql).toContain('status = ANY($1::text[])');
    expect(queries[0].sql).toContain("reason_flagged LIKE 'ขาดเรียนติดต่อกัน%'");
  });

  it('tightens risk tier and SLA for active absence cases', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 1 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const repository = new AutomationRepository(dataSource as never);

    const result = await repository.escalateCaseRiskTier({
      caseId: 20,
      riskTier: 'HIGH',
      slaDueAt: new Date('2026-07-10T00:00:00.000Z'),
      reason: 'ขาดเรียนติดต่อกัน 7 วัน',
    });

    expect(result).toBe(true);
    expect(queries[0].sql).toContain('SET risk_tier = $2');
    expect(queries[0].sql).toContain('sla_due_at = LEAST');
    expect(queries[0].params).toEqual([
      20,
      'HIGH',
      '2026-07-10T00:00:00.000Z',
      'ขาดเรียนติดต่อกัน 7 วัน',
      ['OPEN', 'IN_PROGRESS', 'REPORTED_UP', 'PENDING_REVIEW'],
    ]);
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

  it('queries subject risk candidates from subject rows without mixing daily and subject signals', async () => {
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

    await repository.listSubjectRiskCandidates({
      asOfDate: '2026-07-08',
      mixedWindowDays: 7,
      mixedAbsenceDays: 3,
      avoidanceWindowDays: 30,
      avoidanceConsecutivePeriods: 3,
      avoidanceAbsentPercent: 30,
      termAbsenceDays: 7,
      highAttendancePercent: 80,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(['2026-07-08', 7, 3, 30, 3, 30, 7, 80]);
    expect(queries[0].sql).toContain("a.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain("sess.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain("a.session_kind = 'DAILY'");
    expect(queries[0].sql).toContain('MIXED_SUBJECT_ABSENCE');
    expect(queries[0].sql).toContain('LOW_ATTENDANCE_PERCENT');
  });

  it('deduplicates active attendance-risk cases using the approved reason families', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return {
          records: [{ id: 44, risk_tier: 'MEDIUM', reason_flagged: 'โดดคาบ' }],
          affected: 1,
        };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const repository = new AutomationRepository(dataSource as never);

    const result = await repository.findActiveAttendanceRiskCaseByStudent(
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    );

    expect(result).toEqual({ id: 44, risk_tier: 'MEDIUM', reason_flagged: 'โดดคาบ' });
    expect(queries[0].sql).toContain('reason_flagged LIKE ANY($5::text[])');
    expect(queries[0].params?.[4]).toEqual([
      'ขาดเรียนติดต่อกัน%',
      'โดดคาบ%',
      'เลี่ยงวิชา%',
      'ขาดสะสมต่อเทอม%',
      'เวลาเรียนต่ำกว่า%',
    ]);
  });
});
