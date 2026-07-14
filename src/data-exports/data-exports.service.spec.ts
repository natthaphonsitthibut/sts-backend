import { DataExportsService } from './data-exports.service';
import { DataExportsRepository } from './data-exports.repository';
import type { DataExportJobRow } from './data-export.types';
import type { DataSource } from 'typeorm';

describe('DataExportsService', () => {
  let repository: jest.Mocked<
    Pick<
      DataExportsRepository,
      'createJob' | 'addEvent' | 'failJob' | 'findJobById' | 'prepareRetry'
    >
  >;
  let service: DataExportsService;
  let job: DataExportJobRow;

  beforeEach(() => {
    job = {
      id: 'job-1',
      dataset_code: 'student_roster_basic',
      field_bundle_code: 'basic',
      output_format: 'CSV' as const,
      sensitivity_class: 'OPERATIONAL' as const,
      status: 'PENDING' as const,
      requested_by: 1,
      scope_snapshot: { global: true },
      filter_snapshot: {},
      purpose_code: null,
      purpose_note: null,
      estimated_row_count: null,
      exported_row_count: null,
      artifact_size_bytes: null,
      progress_percent: 0,
      artifact_storage_key: null,
      artifact_sha256: null,
      failure_code: null,
      failure_summary: null,
      started_at: null,
      completed_at: null,
      canceled_at: null,
      expires_at: null,
      created_at: new Date('2026-07-14T00:00:00Z'),
      updated_at: new Date('2026-07-14T00:00:00Z'),
    };
    repository = {
      createJob: jest.fn().mockResolvedValue(job),
      addEvent: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
      findJobById: jest.fn().mockResolvedValue(job),
      prepareRetry: jest.fn().mockResolvedValue(job),
    };
    service = new DataExportsService(
      {} as unknown as DataSource,
      repository as unknown as DataExportsRepository,
    );
  });

  it('returns only datasets matching export capability and domain permission', () => {
    const result = service.getCatalog({
      id: 1,
      username: 'exporter',
      roles: ['ADMIN'],
      permissions: ['export-data', 'students', 'dashboard'],
      data_scope: { global: true },
    });

    expect(result.success).toBe(true);
    expect(result.data.map((item) => item.code)).toEqual([
      'student_roster_basic',
      'student_pii',
      'student_risk',
    ]);
    expect(
      result.data.every((item) => !item.workflowPath || item.workflowPath.startsWith('/')),
    ).toBe(true);
  });

  it('does not expose datasets when the actor lacks the domain permission', () => {
    const result = service.getCatalog({
      id: 1,
      username: 'exporter',
      roles: ['TEACHER'],
      permissions: ['export-data'],
      data_scope: { school_ids: [10010002] },
    });

    expect(result.data).toEqual([]);
  });

  it('does not expose generic exports to own-only actors even with permissions', () => {
    const result = service.getCatalog({
      id: 1,
      username: 'student',
      roles: ['STUDENT'],
      permissions: ['export-data', 'students', 'review-cases'],
      data_scope: { own_only: true },
    });

    expect(result.data).toEqual([]);
  });

  it('does not expose internal storage or query details', () => {
    const result = service.getCatalog({
      id: 1,
      username: 'exporter',
      roles: ['ADMIN'],
      permissions: [
        'export-data',
        'students',
        'import-data',
        'review-cases',
        'attendance-dashboard',
      ],
      data_scope: { global: true },
    });

    const serialized = JSON.stringify(result.data);
    expect(serialized).not.toContain('SELECT ');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
  });

  it('fails closed when creating a generic job without a ready queue', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['ADMIN'],
          permissions: ['export-data', 'students'],
          data_scope: { global: true },
        },
        { datasetCode: 'student_roster_basic', fieldBundleCode: 'basic' },
      ),
    ).rejects.toThrow('ระบบคิวส่งออกข้อมูลยังไม่พร้อม');

    expect(repository.failJob).toHaveBeenCalledWith(
      'job-1',
      'QUEUE_NOT_READY',
      'ระบบคิวส่งออกข้อมูลยังไม่พร้อม กรุณาลองใหม่ภายหลัง',
    );
  });

  it('rejects filters that are not supported by the selected dataset', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['ADMIN'],
          permissions: ['export-data', 'students'],
          data_scope: { global: true },
        },
        {
          datasetCode: 'student_roster_basic',
          fieldBundleCode: 'basic',
          filters: { riskTier: 'HIGH' },
        },
      ),
    ).rejects.toThrow('ตัวกรองไม่รองรับ');

    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('rejects calendar dates that do not exist', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['ADMIN'],
          permissions: ['export-data', 'attendance-dashboard'],
          data_scope: { global: true },
        },
        {
          datasetCode: 'attendance_summary',
          fieldBundleCode: 'daily-summary',
          filters: { dateFrom: '2026-02-30' },
        },
      ),
    ).rejects.toThrow('dateFrom ต้องเป็นวันที่ที่มีอยู่จริง');

    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('prepares and retries an existing failed queue job', async () => {
    repository.findJobById.mockResolvedValue({
      ...job,
      status: 'FAILED',
    });
    const retry = jest.fn().mockResolvedValue(undefined);
    const queueJob = {
      getState: jest.fn().mockResolvedValue('failed'),
      retry,
    };
    (service as unknown as { queue: { getJob: jest.Mock } }).queue = {
      getJob: jest.fn().mockResolvedValue(queueJob),
    };

    await service.retryJob(
      {
        id: 1,
        username: 'exporter',
        roles: ['ADMIN'],
        permissions: ['export-data', 'students'],
        data_scope: { global: true },
      },
      'job-1',
    );

    expect(repository.prepareRetry).toHaveBeenCalledWith('job-1');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(repository.addEvent).toHaveBeenCalledWith('job-1', 1, 'RETRIED', {
      previousStatus: 'FAILED',
    });
  });

  it('builds case grade and room scope through current enrollment aliases', () => {
    const buildCaseScopeWhere = (
      service as unknown as {
        buildCaseScopeWhere: (
          scope: Record<string, unknown>,
          filters: Record<string, unknown>,
        ) => { sql: string; params: unknown[] };
      }
    ).buildCaseScopeWhere.bind(service);

    const result = buildCaseScopeWhere(
      { school_ids: [10010002], grade_levels: [7], room_ids: ['2'] },
      {},
    );

    expect(result.sql).toContain('case_scope_student.student_uuid = c.student_uuid');
    expect(result.sql).toContain('case_scope_current.resolution_state');
    expect(result.sql).toContain('case_scope_student."GradeLevelID_Onec"');
    expect(result.sql).toContain('case_scope_student."RoomID_Onec"');
    expect(result.params).toEqual([[10010002], [7], ['2']]);
  });
});
