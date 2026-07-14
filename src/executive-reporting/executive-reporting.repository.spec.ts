import { ExecutiveReportingRepository } from './executive-reporting.repository';

describe('ExecutiveReportingRepository', () => {
  function buildRepository() {
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
    return {
      repository: new ExecutiveReportingRepository(dataSource as never),
      queries,
    };
  }

  it('queries canonical enrollment, risk, observation and case sources', async () => {
    const { repository, queries } = buildRepository();
    await repository.getOverview({ scope: { global: true }, groupBy: 'PROVINCE' });

    const sql = queries[0].sql;
    expect(sql).toContain('student_current_enrollment_resolution');
    expect(sql).toContain('student_risk_profiles');
    expect(sql).toContain('student_observations');
    expect(sql).toContain('FROM cases case_record');
    expect(sql).not.toContain('warehouse');
    expect(sql).not.toContain('materialized');
  });

  it('counts REPORTED_UP once per case without event fanout', async () => {
    const { repository, queries } = buildRepository();
    await repository.getOverview({ scope: { global: true }, groupBy: 'PROVINCE' });

    const sql = queries[0].sql;
    expect(sql).toContain("case_record.status = 'REPORTED_UP'");
    expect(sql).not.toContain('JOIN case_report_ups');
    expect(sql).toContain('GROUP BY case_record.school_id');
  });

  it('intersects actor scope, area filters and time filters with parameters', async () => {
    const { repository, queries } = buildRepository();
    await repository.getOverview({
      scope: { provinces: ['เชียงใหม่'] },
      groupBy: 'SCHOOL',
      province: 'เชียงใหม่',
      schoolId: 1001,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-15T23:59:59.000Z',
    });

    expect(queries[0].sql).toContain('school.province = ANY($1::text[])');
    expect(queries[0].sql).toContain('school.province = $2');
    expect(queries[0].sql).toContain('school.id = $3');
    expect(queries[0].sql).toContain('case_record.created_at >= $4::timestamptz');
    expect(queries[0].sql).toContain('case_record.created_at <= $5::timestamptz');
    expect(queries[0].params).toEqual([
      ['เชียงใหม่'],
      'เชียงใหม่',
      1001,
      '2026-07-01T00:00:00.000Z',
      '2026-07-15T23:59:59.000Z',
    ]);
  });

  it.each([
    ['PROVINCE', 'GROUP BY school_metrics.province'],
    ['DISTRICT', 'GROUP BY school_metrics.province, school_metrics.district'],
    [
      'SCHOOL',
      'school_metrics.province, school_metrics.district, school_metrics.school_id, school_metrics.school_name',
    ],
  ] as const)('builds the canonical %s rollup', async (groupBy, expectedSql) => {
    const { repository, queries } = buildRepository();
    await repository.getOverview({ scope: { global: true }, groupBy });
    expect(queries[0].sql).toContain(expectedSql);
  });
});
