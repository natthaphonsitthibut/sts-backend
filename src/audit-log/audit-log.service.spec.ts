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
    expect(queries[0].params?.[0]).toEqual(
      expect.arrayContaining(['STUDENT_ACCOUNT_BULK_GENERATE', 'STUDENT_TEMP_PASSWORD_REISSUE']),
    );
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

  it('loads one audit log through the same permission and scope gate', async () => {
    const scopedActor: AuthenticatedRequestUser = {
      ...actor,
      data_scope: { school_ids: [10010003] },
    };
    const row = {
      id: '42',
      actor_label: 'newnew',
      action: 'STUDENT_ACCOUNT_BULK_GENERATE',
      target_type: 'student_accounts',
      target_id: 'batch-42',
      metadata: {
        createdCount: 42,
        schoolId: 10010003,
        grade: 'ป.3',
        scope: { school_ids: [10010003] },
      },
      created_at: new Date('2026-06-29T06:28:00.000Z'),
      total_count: 1,
    };
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [row], affected: 1 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };
    const service = new AuditLogService(dataSource as never);

    const result = await service.getById(scopedActor, '42');

    expect(result.data).toMatchObject({
      id: '42',
      domain: 'student_accounts',
      actionLabel: 'สร้างบัญชีนักเรียนแบบชุด',
      actorLabel: 'newnew',
      targetType: 'student_accounts',
      targetId: 'batch-42',
    });
    expect(result.data.details).toContainEqual({ label: 'สร้างสำเร็จ', value: 42 });
    expect(queries).toHaveLength(2);
    expect(queries[1].sql).toContain('a.id = $1::bigint');
    expect(queries[1].sql).toContain("-> 'school_ids'");
    expect(queries[1].params).toContainEqual(['10010003']);
  });
});
