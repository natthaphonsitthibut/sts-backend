import { AutomationRepository } from './automation.repository';

describe('AutomationRepository', () => {
  it('counts cumulative absent days with the ประวัติการเข้าเรียน day verdict', async () => {
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

    await repository.listCumulativeAbsentStudents(3, '2026-06-27');

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([3, '2026-06-27']);
    expect(queries[0].sql).toContain('GROUP BY a.student_uuid, a."AttendanceDate"');
    // ลา (4) is not measured; มา/สาย count as attended.
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" <> 4)');
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" IN (1, 3))');
    expect(queries[0].sql).toContain('COUNT(*) FILTER (WHERE a."AttendanceStatus" IN (1, 3)) = 0');
    expect(queries[0].sql).toContain("a.session_kind IN ('DAILY', 'SUBJECT')");
    expect(queries[0].sql).toContain('WITH current_enrollments AS');
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('HAVING COUNT(*) >= $1');
    expect(queries[0].sql).toContain(
      `demo_distribution."RecordedBy" = 'SYSTEM:DEMO_RISK_DISTRIBUTION'`,
    );
    // Days no longer have to be consecutive.
    expect(queries[0].sql).not.toContain('streak');
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
    expect(queries[0].sql).toContain("attendance.session_kind IN ('DAILY', 'SUBJECT')");
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
      ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW'],
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
      ['ขาดเรียนสะสม%', 'ขาดเรียนติดต่อกัน%'],
    ]);
    expect(queries[0].sql).toContain('status = ANY($1::text[])');
    expect(queries[0].sql).toContain('reason_flagged LIKE ANY($5::text[])');
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
});
