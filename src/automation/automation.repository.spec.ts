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

    await repository.listConsecutiveAbsentStudents(3);

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([3]);
    expect(queries[0].sql).toContain('GROUP BY student_uuid, "AttendanceDate"');
    expect(queries[0].sql).toContain('BOOL_AND("AttendanceStatus" = 2)');
    expect(queries[0].sql).toContain('current_absence_streak');
    expect(queries[0].sql).not.toContain('ORDER BY "AttendanceDate" DESC, "AttendanceID" DESC');
  });

  it('deduplicates against active absence cases, not only OPEN cases', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ id: 20 }], affected: 1 };
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

    expect(result).toBe(20);
    expect(queries[0].params).toEqual([
      ['OPEN', 'IN_PROGRESS', 'AWAITING_HELP', 'PENDING_REVIEW'],
      'student-uuid-1',
      'สมชาย ใจดี',
      10010002,
    ]);
    expect(queries[0].sql).toContain('status = ANY($1::text[])');
    expect(queries[0].sql).toContain("reason_flagged LIKE 'ขาดเรียนติดต่อกัน%'");
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
