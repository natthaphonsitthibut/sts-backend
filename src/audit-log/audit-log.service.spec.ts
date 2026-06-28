import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const actor: AuthenticatedRequestUser = {
    id: 1,
    username: 'admin',
    roles: ['ADMIN'],
    permissions: ['manage-student-accounts'],
  };

  it('binds the action list as a PostgreSQL array parameter', async () => {
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
    const service = new AuditLogService(dataSource as never);

    const result = await service.list(actor, {
      domain: 'student_accounts',
      page: 1,
      limit: 20,
    });

    expect(result.data).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('a.action = ANY($1::text[])');
    expect(queries[0].sql).toContain("NULLIF(a.metadata ->> 'scopeLabel', '')");
    expect(queries[0].params?.[0]).toEqual(['STUDENT_ACCOUNT_BULK_GENERATE']);
  });

  it('filters student account history by province scope', async () => {
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
    const service = new AuditLogService(dataSource as never);

    await service.list(actor, {
      domain: 'student_accounts',
      province: 'กรุงเทพมหานคร',
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain("a.metadata ->> 'province'");
    expect(queries[0].sql).toContain("a.metadata -> 'scope' -> 'provinces'");
    expect(queries[0].params).toContain('กรุงเทพมหานคร');
  });
});
