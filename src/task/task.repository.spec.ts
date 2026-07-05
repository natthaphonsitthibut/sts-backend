import { TaskRepository } from './task.repository';

describe('TaskRepository', () => {
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
    const repository = new TaskRepository(dataSource as never);

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
      ['OPEN', 'IN_PROGRESS', 'AWAITING_HELP', 'PENDING_REVIEW'],
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
    const repository = new TaskRepository(dataSource as never);

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
    const repository = new TaskRepository(dataSource as never);
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
    const repository = new TaskRepository(dataSource as never);
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
