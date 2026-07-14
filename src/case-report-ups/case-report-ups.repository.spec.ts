import { CaseReportUpsRepository } from './case-report-ups.repository';

describe('CaseReportUpsRepository', () => {
  it('locks a case only through explicit school ownership', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new CaseReportUpsRepository({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await repository.withTransaction(async (runner) => {
      await repository.lockSchoolOwnedCase(10, [101], runner);
    });

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([10, [101]]);
    expect(queries[0].sql).toContain('case_record.school_id = ANY($2::int[])');
    expect(queries[0].sql).toContain('FOR UPDATE OF case_record');
    expect(queryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('applies province scope and bounded pagination to the executive queue', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new CaseReportUpsRepository({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await repository.listReportUps({ provinces: ['กรุงเทพมหานคร'] }, 2, 20);

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([['กรุงเทพมหานคร'], 20, 20]);
    expect(queries[0].sql).toContain('report_up.province_snapshot = ANY($1::text[])');
    expect(queries[0].sql).toContain('LIMIT $2 OFFSET $3');
    expect(queries[0].sql).toContain('COUNT(*) OVER()');
  });

  it('fails closed for own-only queue scope', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const repository = new CaseReportUpsRepository({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await repository.listReportUps({ own_only: true }, 1, 10);

    expect(queries[0].sql).toContain('WHERE 1=0');
  });
});
