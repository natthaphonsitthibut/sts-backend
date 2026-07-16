import { DataExportsService } from './data-exports.service';
import { DataExportsRepository } from './data-exports.repository';
import { DATA_EXPORT_CATALOG } from './data-export.registry';
import type { DataExportJobRow } from './data-export.types';
import type { DataSource } from 'typeorm';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import type { FileStorageAdapter } from '../files/storage/file-storage.types';

describe('DataExportsService', () => {
  let repository: jest.Mocked<
    Pick<
      DataExportsRepository,
      | 'createJob'
      | 'addEvent'
      | 'failJob'
      | 'findJobById'
      | 'prepareRetry'
      | 'claimJob'
      | 'completeJob'
      | 'findActiveRequester'
      | 'expireCompletedJobs'
      | 'listExpiredArtifacts'
      | 'clearExpiredArtifact'
    >
  >;
  let storage: jest.Mocked<FileStorageAdapter>;
  let service: DataExportsService;
  let job: DataExportJobRow;
  let attendanceService: { getSchools: jest.Mock };
  let statusCatalogService: { getCatalog: jest.Mock };

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
      claimJob: jest.fn().mockResolvedValue(job),
      completeJob: jest.fn().mockResolvedValue({ ...job, status: 'COMPLETED' }),
      findActiveRequester: jest.fn().mockResolvedValue({
        id: 1,
        username: 'exporter',
        role: 'ADMIN',
        permissions: ['export-data', 'students'],
        data_scope: { global: true },
        role_default_permissions: [],
      }),
      expireCompletedJobs: jest.fn().mockResolvedValue([]),
      listExpiredArtifacts: jest.fn().mockResolvedValue([]),
      clearExpiredArtifact: jest.fn().mockResolvedValue(true),
    };
    storage = {
      kind: 'private-object',
      save: jest.fn().mockResolvedValue(undefined),
      saveStream: jest.fn().mockImplementation(async (source: Readable) => {
        for await (const chunk of source) {
          // Consume the stream just like the real storage adapters.
          void chunk;
        }
      }),
      resolve: jest.fn(),
      open: jest.fn().mockResolvedValue(Readable.from('csv')),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    attendanceService = {
      getSchools: jest.fn().mockResolvedValue({ data: [{ id: 1001, name: 'โรงเรียนทดสอบ' }] }),
    };
    statusCatalogService = {
      getCatalog: jest.fn().mockResolvedValue([
        { code: 'IN_PROGRESS', label: 'กำลังติดตาม' },
        { code: 'RESOLVED', label: 'ปิดเคสแล้ว' },
      ]),
    };
    service = new DataExportsService(
      {} as unknown as DataSource,
      repository as unknown as DataExportsRepository,
      attendanceService as never,
      statusCatalogService as never,
      undefined,
      storage,
      undefined,
    );
  });

  it('returns only datasets matching export capability and domain permission', async () => {
    const result = await service.getCatalog({
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
    expect(result.data.find((item) => item.code === 'student_risk')?.filterDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'schoolId',
          control: 'SELECT',
          options: [{ value: '1001', label: 'โรงเรียนทดสอบ' }],
        }),
        expect.objectContaining({ key: 'riskTier', control: 'SELECT' }),
      ]),
    );
    expect(attendanceService.getSchools).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      100_000,
      { global: true },
    );
    expect(statusCatalogService.getCatalog).not.toHaveBeenCalled();
  });

  it('returns case status options from the workflow status catalog', async () => {
    const result = await service.getCatalog({
      id: 1,
      username: 'reviewer',
      roles: ['ADMIN'],
      permissions: ['export-data', 'review-cases'],
      data_scope: { global: true },
    });

    expect(
      result.data.find((item) => item.code === 'case_summary')?.filterDefinitions,
    ).toContainEqual(
      expect.objectContaining({
        key: 'status',
        control: 'SELECT',
        options: [
          { value: 'IN_PROGRESS', label: 'กำลังติดตาม' },
          { value: 'RESOLVED', label: 'ปิดเคสแล้ว' },
        ],
      }),
    );
    expect(statusCatalogService.getCatalog).toHaveBeenCalledWith('CASE_WORKFLOW');
  });

  it('does not expose datasets when the actor lacks the domain permission', async () => {
    const result = await service.getCatalog({
      id: 1,
      username: 'exporter',
      roles: ['TEACHER'],
      permissions: ['export-data'],
      data_scope: { school_ids: [10010002] },
    });

    expect(result.data).toEqual([]);
    expect(attendanceService.getSchools).not.toHaveBeenCalled();
    expect(statusCatalogService.getCatalog).not.toHaveBeenCalled();
  });

  it('keeps executive actors restricted even when raw permissions are regranted', async () => {
    const result = await service.getCatalog({
      id: 1,
      username: 'executive',
      roles: ['EXECUTIVE'],
      permissions: ['*', 'export-data', 'students', 'dashboard', 'review-cases'],
      data_scope: { global: true },
    });

    expect(result.data).toEqual([]);
  });

  it('denies executive actors from creating raw jobs despite explicit raw permissions', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'executive',
          roles: ['EXECUTIVE'],
          permissions: ['export-data', 'students'],
          data_scope: { global: true },
        },
        {
          datasetCode: 'student_roster_basic',
          fieldBundleCode: 'basic',
          filters: {},
        },
      ),
    ).rejects.toThrow('ไม่มีสิทธิ์ส่งออกชุดข้อมูลนี้');

    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('publishes minimized school, observation, and report-up products by permission', async () => {
    const result = await service.getCatalog({
      id: 1,
      username: 'exporter',
      roles: ['ADMIN'],
      permissions: [
        'export-data',
        'manage-school-structure',
        'manage-student-observations',
        'report-up-cases',
      ],
      data_scope: { global: true },
    });

    expect(result.data.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'school_teacher_roster',
        'school_classroom_structure',
        'classroom_assignments',
        'observation_aggregate',
        'case_report_up_aggregate',
      ]),
    );
    for (const item of result.data.filter((candidate) => candidate.deliveryMode === 'ASYNC_JOB')) {
      expect(item.supportedFilters).toEqual(
        item.filterDefinitions.map((definition) => definition.key),
      );
      expect(new Set(item.supportedFilters).size).toBe(item.supportedFilters.length);
    }
  });

  it('does not expose generic exports to own-only actors even with permissions', async () => {
    const result = await service.getCatalog({
      id: 1,
      username: 'student',
      roles: ['STUDENT'],
      permissions: ['export-data', 'students', 'review-cases'],
      data_scope: { own_only: true },
    });

    expect(result.data).toEqual([]);
  });

  it('does not expose internal storage or query details', async () => {
    const result = await service.getCatalog({
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

  it('rejects integer filters outside the PostgreSQL integer range', async () => {
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
          filters: { schoolId: 2_147_483_648 },
        },
      ),
    ).rejects.toThrow('schoolId ต้องเป็นจำนวนเต็มบวก');

    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('requires a purpose code and note for sensitive operational datasets', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['ADMIN'],
          permissions: ['export-data', 'dashboard'],
          data_scope: { global: true },
        },
        { datasetCode: 'student_risk', fieldBundleCode: 'risk-summary' },
      ),
    ).rejects.toThrow('ต้องระบุรหัสวัตถุประสงค์');

    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('rejects a create filter outside the current school scope', async () => {
    await expect(
      service.createJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['DIRECTOR'],
          permissions: ['export-data', 'students'],
          data_scope: { school_ids: [1001] },
        },
        {
          datasetCode: 'student_roster_basic',
          fieldBundleCode: 'basic',
          filters: { schoolId: 2002 },
        },
      ),
    ).rejects.toThrow('ตัวกรองอยู่นอกขอบเขตข้อมูล');
  });

  it('fails processing closed when current export permission was revoked', async () => {
    repository.findActiveRequester.mockResolvedValueOnce({
      id: 1,
      username: 'exporter',
      role: 'ADMIN',
      permissions: ['students'],
      data_scope: { global: true },
      role_default_permissions: [],
    });

    await (service as unknown as { processJob(jobId: string): Promise<void> }).processJob('job-1');

    expect(repository.failJob).toHaveBeenCalledWith(
      'job-1',
      'EXPORT_ACCESS_REVOKED',
      expect.stringContaining('สิทธิ์'),
    );
    expect(storage.saveStream).not.toHaveBeenCalled();
  });

  it('streams bounded CSV chunks and records checksum metrics after upload', async () => {
    const firstBatch = Array.from({ length: 1_000 }, (_, index) => ({
      student_uuid: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      first_name: index === 0 ? '=formula' : 'Student',
      last_name: String(index + 1),
      school_name: 'School',
      grade: '1',
      room: '1',
      student_status: 'ศึกษาอยู่',
    }));
    const query = jest
      .fn()
      .mockResolvedValueOnce({ records: firstBatch, affected: firstBatch.length })
      .mockResolvedValueOnce({
        records: [{ ...firstBatch[0], student_uuid: '00000000-0000-0000-0000-000000001001' }],
        affected: 1,
      });
    const dataSource = {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query,
        release: jest.fn().mockResolvedValue(undefined),
      }),
    } as unknown as DataSource;
    const chunks: Buffer[] = [];
    storage.saveStream.mockImplementationOnce(async (source) => {
      for await (const chunk of source) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
    });
    repository.claimJob.mockResolvedValueOnce({ ...job, status: 'RUNNING' });
    repository.findJobById.mockResolvedValue({ ...job, status: 'RUNNING' });
    service = new DataExportsService(
      dataSource,
      repository as unknown as DataExportsRepository,
      attendanceService as never,
      statusCatalogService as never,
      undefined,
      storage,
    );

    await (service as unknown as { processJob(jobId: string): Promise<void> }).processJob('job-1');

    const csv = Buffer.concat(chunks);
    expect(csv.toString()).toContain("'=formula");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [1_000], true);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('s.student_uuid > $1::uuid'),
      ['00000000-0000-0000-0000-000000001000', 1_000],
      true,
    );
    const dataLines = csv.toString().trim().split('\n').slice(1);
    expect(dataLines).toHaveLength(1_001);
    expect(new Set(dataLines.map((line) => line.split(',')[0])).size).toBe(1_001);
    expect(repository.completeJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        rowCount: 1_001,
        artifactSizeBytes: csv.byteLength,
        artifactSha256: createHash('sha256').update(csv).digest('hex'),
      }),
    );
  });

  it.each(['=formula', '+formula', '-formula', '@formula', '\t=formula', '\r=formula'])(
    'neutralizes spreadsheet formula prefixes in CSV cells: %p',
    (value) => {
      const csvCell = (service as unknown as { csvCell(cellValue: unknown): string }).csvCell(
        value,
      );

      expect(csvCell).toBe(`"'${value.replace(/"/g, '""')}"`);
    },
  );

  it('fails instead of truncating when a streamed export exceeds the row cap', async () => {
    const fullBatch = Array.from({ length: 1_000 }, () => ({ student_uuid: 'student' }));
    let batchNumber = 0;
    const loadRows = jest.fn(() => {
      batchNumber += 1;
      return Promise.resolve({
        headers: ['student_uuid'],
        rows: batchNumber <= 100 ? fullBatch : [{ student_uuid: 'over-cap' }],
        nextCursor: { studentUuid: String(batchNumber * 1_000) },
      });
    });
    (
      service as unknown as {
        loadRows: typeof loadRows;
      }
    ).loadRows = loadRows;
    repository.claimJob.mockResolvedValueOnce({ ...job, status: 'RUNNING' });
    repository.findJobById.mockResolvedValue({ ...job, status: 'RUNNING' });

    await expect(
      (service as unknown as { processJob(jobId: string): Promise<void> }).processJob('job-1'),
    ).rejects.toThrow('ROW_CAP_EXCEEDED');

    expect(repository.failJob).toHaveBeenCalledWith(
      'job-1',
      'ROW_CAP_EXCEEDED',
      expect.stringContaining('จำนวนแถวเกิน'),
    );
    expect(repository.completeJob).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('data-exports/job-1.csv');
  });

  it.each([
    [
      'student_roster_basic',
      { studentUuid: '00000000-0000-0000-0000-000000000001' },
      's.student_uuid >',
    ],
    ['student_risk', { studentUuid: '00000000-0000-0000-0000-000000000001' }, 's.student_uuid >'],
    ['attendance_summary', { attendanceDate: '2026-07-01' }, 'a."AttendanceDate" >'],
    ['case_summary', { status: 'OPEN' }, 'c.status >'],
    ['case_operational', { caseId: 10 }, 'c.id >'],
    ['school_teacher_roster', { membershipId: '10' }, 'membership.id >'],
    ['school_classroom_structure', { classroomId: '10' }, 'classroom.id >'],
    ['classroom_assignments', { assignmentId: '10' }, 'assignment.id >'],
    [
      'observation_aggregate',
      {
        observationDate: '2026-07-01',
        schoolId: 1,
        dimensionCode: 'LEARNING',
        concernLevel: 'WATCH',
      },
      'observation.observed_at::date',
    ],
    [
      'case_report_up_aggregate',
      { reportDate: '2026-07-01', schoolId: 1, status: 'REPORTED_UP' },
      'report_up.reported_at::date',
    ],
  ])('uses a stable keyset query for %s', async (datasetCode, cursor, keysetSql) => {
    const query = jest.fn().mockResolvedValue({ records: [], affected: 0 });
    const dataSource = {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query,
        release: jest.fn().mockResolvedValue(undefined),
      }),
    } as unknown as DataSource;
    const keysetService = new DataExportsService(
      dataSource,
      repository as unknown as DataExportsRepository,
      attendanceService as never,
      statusCatalogService as never,
      undefined,
      storage,
      undefined,
    );
    const item = DATA_EXPORT_CATALOG.find((candidate) => candidate.code === datasetCode)!;

    await (
      keysetService as unknown as {
        loadRows(
          catalogItem: typeof item,
          exportJob: DataExportJobRow,
          limit: number,
          nextCursor: Record<string, string | number>,
        ): Promise<unknown>;
      }
    ).loadRows(item, { ...job, dataset_code: datasetCode }, 10, cursor);

    expect(query).toHaveBeenCalledWith(expect.stringContaining(keysetSql), expect.any(Array), true);
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('OFFSET'),
      expect.any(Array),
      true,
    );
  });

  it('denies download when current scope no longer covers the job snapshot', async () => {
    repository.findJobById.mockResolvedValueOnce({
      ...job,
      status: 'COMPLETED',
      scope_snapshot: { school_ids: [1001, 2002] },
      artifact_storage_key: 'data-exports/job-1.csv',
      expires_at: new Date('2099-01-01T00:00:00Z'),
    });

    await expect(
      service.downloadJob(
        {
          id: 1,
          username: 'exporter',
          roles: ['DIRECTOR'],
          permissions: ['export-data', 'students'],
          data_scope: { school_ids: [1001] },
        },
        'job-1',
      ),
    ).rejects.toThrow('ขอบเขตข้อมูลปัจจุบันไม่ครอบคลุม');
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('expires jobs, deletes private artifacts, and clears their storage keys', async () => {
    repository.expireCompletedJobs.mockResolvedValueOnce([{ ...job, status: 'EXPIRED' }]);
    repository.listExpiredArtifacts.mockResolvedValueOnce([
      {
        ...job,
        status: 'EXPIRED',
        artifact_storage_key: 'data-exports/job-1.csv',
      },
    ]);

    await expect(
      service.cleanupExpiredArtifacts(new Date('2026-07-15T00:00:00Z')),
    ).resolves.toEqual({ expired: 1, deleted: 1 });
    expect(storage.delete).toHaveBeenCalledWith('data-exports/job-1.csv');
    expect(repository.clearExpiredArtifact).toHaveBeenCalledWith('job-1', 'data-exports/job-1.csv');
  });

  it('fails fast when production would use local artifact storage', async () => {
    const productionService = new DataExportsService(
      {} as unknown as DataSource,
      repository as unknown as DataExportsRepository,
      attendanceService as never,
      statusCatalogService as never,
      undefined,
      { ...storage, kind: 'local' },
      { isProduction: true } as never,
    );

    await expect(productionService.onModuleInit()).rejects.toThrow(
      'Production data exports require private object storage',
    );
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
