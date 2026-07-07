import { RiskProfileRepository } from './risk-profile.repository';

describe('RiskProfileRepository', () => {
  it('upserts risk profiles for selected active students', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: 2 }], affected: 1 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new RiskProfileRepository(dataSource as never);

    const updated = await repository.recalculateStudents(
      [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
      {
        lowConsecutiveAbsentDays: 3,
        mediumConsecutiveAbsentDays: 5,
        highConsecutiveAbsentDays: 7,
        watchProgressRatio: 0.7,
        lowAttendancePercent: 95,
        mediumAttendancePercent: 90,
        highAttendancePercent: 80,
        lateWeight: 0.25,
      },
    );

    expect(updated).toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      3,
      5,
      7,
      0.7,
      95,
      90,
      80,
      0.25,
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    ]);
    expect(queries[0].sql).toContain('INSERT INTO student_risk_profiles');
    expect(queries[0].sql).toContain('WHERE s.student_uuid = ANY($9::uuid[])');
    expect(queries[0].sql).toContain("AND a.session_kind = 'DAILY'");
    expect(queries[0].sql).toContain('ON CONFLICT (student_uuid) DO UPDATE SET');
    expect(queries[0].sql).toContain('JOIN student_current_enrollment_resolution');
  });

  it('recalculates all active enrollments without a student filter', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [{ count: 5 }], affected: 1 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    const repository = new RiskProfileRepository(dataSource as never);

    await repository.recalculateAll({
      lowConsecutiveAbsentDays: 3,
      mediumConsecutiveAbsentDays: 5,
      highConsecutiveAbsentDays: 7,
      watchProgressRatio: 0.7,
      lowAttendancePercent: 95,
      mediumAttendancePercent: 90,
      highAttendancePercent: 80,
      lateWeight: 0.25,
    });

    expect(queries[0].params).toEqual([3, 5, 7, 0.7, 95, 90, 80, 0.25]);
    expect(queries[0].sql).not.toContain('ANY($9::uuid[])');
  });
});
