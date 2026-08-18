import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const actor: AuthenticatedRequestUser = {
    id: 1,
    username: 'admin',
    roles: ['ADMIN'],
    permissions: ['manage-users-list'],
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
      domain: 'users',
      page: 1,
      limit: 20,
    });

    expect(result.data).toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('a.action = ANY($1::text[])');
    expect(queries[0].params?.[0]).toEqual(
      expect.arrayContaining(['USER_CREATE', 'USER_DEACTIVATE', 'USER_TEMP_PASSWORD_REISSUE']),
    );
  });

  it('filters user history by province scope', async () => {
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
      domain: 'users',
      province: 'กรุงเทพมหานคร',
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain("a.metadata ->> 'province'");
    expect(queries[0].sql).toContain("a.metadata -> 'scope' -> 'provinces'");
    expect(queries[0].params).toContain('กรุงเทพมหานคร');
  });

  it('filters task history by task type metadata', async () => {
    const taskActor: AuthenticatedRequestUser = {
      ...actor,
      permissions: ['attendance-dashboard'],
    };
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

    await service.list(taskActor, {
      domain: 'tasks',
      taskType: 'VISIT',
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain("a.metadata ->> 'taskType' = $");
    expect(queries[0].params).toContain('VISIT');
    expect(queries[0].params?.[0]).toEqual(
      expect.arrayContaining(['TASK_CREATE', 'LINK_LOCK', 'LINK_UNLOCK']),
    );
  });

  it('accepts a cross-domain link action when taskType is present', async () => {
    const taskActor: AuthenticatedRequestUser = {
      ...actor,
      permissions: ['attendance-dashboard'],
      data_scope: { global: true },
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const service = new AuditLogService({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await expect(
      service.list(taskActor, {
        domain: 'tasks',
        taskType: 'VISIT',
        action: 'LINK_LOCK',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects taskType paired with the wrong permission domain', async () => {
    const service = new AuditLogService({} as never);

    await expect(
      service.list(
        { ...actor, permissions: ['students'], data_scope: { global: true } },
        { domain: 'students', taskType: 'VISIT' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serves action labels from the backend definitions', () => {
    const service = new AuditLogService({} as never);
    const result = service.getActionOptions(
      { ...actor, permissions: ['dashboard'], data_scope: { global: true } },
      { domain: 'tasks' },
    );

    expect(result.data).toEqual(
      expect.arrayContaining([
        { value: 'TASK_CREATE', label: 'สร้างภารกิจหรือลิงก์' },
        { value: 'LINK_LOCK', label: 'ปิดลิงก์' },
      ]),
    );
  });

  it('records scoped audit metadata with a raw TypeORM query runner', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return queries.length === 1
          ? [
              {
                id: 10010003,
                province: 'เชียงใหม่',
                district: 'เมืองเชียงใหม่',
                sub_district: 'ศรีภูมิ',
              },
            ]
          : [];
      }),
    };
    const service = new AuditLogService({} as never);

    await expect(
      service.recordAtomic(
        {
          actorUserId: 1,
          actorLabel: 'admin',
          action: 'MASTER_DATA_EDIT',
          targetType: 'school_classrooms',
          targetId: '21',
          metadata: { schoolId: 10010003 },
        },
        queryRunner,
      ),
    ).resolves.toBeUndefined();

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const insertParams = queries[1]?.params ?? [];
    expect(JSON.parse(String(insertParams[5]))).toMatchObject({
      schoolId: 10010003,
      scope: {
        school_ids: [10010003],
        provinces: ['เชียงใหม่'],
        districts: ['เมืองเชียงใหม่'],
        sub_districts: ['ศรีภูมิ'],
      },
    });
  });

  it('filters history by target type and id', async () => {
    const taskActor: AuthenticatedRequestUser = {
      ...actor,
      permissions: ['dashboard'],
    };
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

    await service.list(taskActor, {
      domain: 'cases',
      targetType: 'case',
      targetId: '42',
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain('a.target_type = $');
    expect(queries[0].sql).toContain('a.target_id = $');
    expect(queries[0].params).toContain('case');
    expect(queries[0].params).toContain('42');
  });

  it('filters case history by case id across case and referral events', async () => {
    const caseActor: AuthenticatedRequestUser = {
      ...actor,
      permissions: ['dashboard'],
    };
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

    await service.list(caseActor, {
      domain: 'cases',
      caseId: 42,
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain("(a.target_type = 'case' AND a.target_id = $");
    expect(queries[0].sql).toContain("a.metadata ->> 'caseId' = $");
    expect(queries[0].params).toContain('42');
  });

  it('rejects case id filter outside the cases domain', async () => {
    const service = new AuditLogService({ createQueryRunner: jest.fn() } as never);

    await expect(
      service.list(actor, {
        domain: 'users',
        caseId: 42,
        page: 1,
        limit: 20,
      }),
    ).rejects.toThrow('caseId ใช้ได้กับประวัติเคสเท่านั้น');
  });

  it('rejects actors without the domain permission', async () => {
    const service = new AuditLogService({ createQueryRunner: jest.fn() } as never);

    await expect(
      service.list(
        {
          ...actor,
          permissions: ['manage-users-list'],
        },
        {
          domain: 'cases',
          page: 1,
          limit: 20,
        },
      ),
    ).rejects.toThrow('ไม่มีสิทธิ์ดูประวัติส่วนนี้');
  });

  it('applies actor scope conditions to list queries', async () => {
    const scopedActor: AuthenticatedRequestUser = {
      ...actor,
      data_scope: { school_ids: [10010003] },
    };
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const service = new AuditLogService({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    await service.list(scopedActor, {
      domain: 'users',
      page: 1,
      limit: 20,
    });

    expect(queries[0].sql).toContain("-> 'school_ids'");
    expect(queries[0].params).toContainEqual(['10010003']);
  });

  it('returns pagination metadata and redacts non-allowlisted metadata', async () => {
    const globalActor: AuthenticatedRequestUser = {
      ...actor,
      data_scope: { global: true },
    };
    const row = {
      id: '77',
      actor_label: 'admin',
      action: 'USER_TEMP_PASSWORD_REISSUE',
      target_type: 'users',
      target_id: 'student-77',
      target_username: null,
      school_name: null,
      metadata: {
        expiresAt: '2026-07-05T00:00:00.000Z',
        tempPassword: 'MUST_NOT_LEAK',
      },
      created_at: new Date('2026-07-04T00:00:00.000Z'),
      total_count: 55,
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [row], affected: 1 }),
    };
    const service = new AuditLogService({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    const result = await service.list(globalActor, {
      domain: 'users',
      page: 2,
      limit: 20,
    });

    expect(result.meta).toEqual({
      page: 2,
      limit: 20,
      totalCount: 55,
      totalPages: 3,
    });
    expect(result.data[0]?.details).toEqual([
      { label: 'รหัสหมดอายุ', value: '2026-07-05T00:00:00.000Z' },
    ]);
  });

  it('loads one audit log through the same permission and scope gate', async () => {
    const scopedActor: AuthenticatedRequestUser = {
      ...actor,
      data_scope: { school_ids: [10010003] },
    };
    const row = {
      id: '42',
      actor_label: 'newnew',
      action: 'USER_UPDATE',
      target_type: 'users',
      target_id: 'batch-42',
      metadata: {
        fieldCount: 42,
        schoolId: 10010003,
        grade: 'ป.3',
        scope: { school_ids: [10010003] },
      },
      school_name: 'โรงเรียนตัวอย่าง',
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
      domain: 'users',
      actionLabel: 'แก้ไขผู้ใช้งาน',
      actorLabel: 'newnew',
      targetType: 'users',
      targetId: 'batch-42',
    });
    expect(result.data.details).toContainEqual({ label: 'จำนวนข้อมูลที่แก้', value: 42 });
    expect(queries).toHaveLength(2);
    expect(queries[1].sql).toContain('a.id = $1::bigint');
    expect(queries[1].sql).toContain("-> 'school_ids'");
    expect(queries[1].params).toContainEqual(['10010003']);
  });

  it('returns before and after values for resolved quarantine fields', async () => {
    const importActor: AuthenticatedRequestUser = {
      ...actor,
      permissions: ['import-data'],
    };
    const row = {
      id: '94',
      actor_label: 'ผู้ดูแลระบบ',
      action: 'IMPORT_QUARANTINE_RESOLVED',
      target_type: 'student_import_quarantine_row',
      target_id: '94',
      metadata: {
        studentName: 'ชลธิชา ใจงาม',
        changedFieldLabels: 'ห้อง',
        changedFieldDetails: [{ label: 'ห้อง', oldValue: '99', newValue: '1' }],
      },
      school_name: null,
      created_at: new Date('2026-07-03T08:00:00.000Z'),
      total_count: 1,
    };
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [row], affected: 1 }),
    };
    const service = new AuditLogService({
      createQueryRunner: jest.fn(() => queryRunner),
    } as never);

    const result = await service.getById(importActor, '94');

    expect(result.data.details).toContainEqual({ label: 'ห้อง (ก่อนแก้)', value: '99' });
    expect(result.data.details).toContainEqual({ label: 'ห้อง (หลังแก้)', value: '1' });
    expect(result.data.details).not.toContainEqual({ label: 'ข้อมูลที่แก้', value: 'ห้อง' });
  });
});
