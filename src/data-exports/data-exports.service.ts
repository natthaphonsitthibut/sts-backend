import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  StreamableFile,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { Queue, Worker } from 'bullmq';
import { DataSource } from 'typeorm';
import { hasPermission, type AuthenticatedRequestUser } from '../auth';
import { isUnconfiguredDataScope, normalizeDataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queueConfig } from '../config/queue.config';
import { queryDataSource } from '../database/sql-query';
import { DATA_EXPORT_CATALOG } from './data-export.registry';
import { DataExportsRepository } from './data-exports.repository';
import type { CreateDataExportJobDto, DataExportJobListQueryDto } from './dto/data-export.dto';
import type {
  DataExportCatalogItem,
  DataExportJobResponse,
  DataExportJobRow,
} from './data-export.types';

const ROW_CAP = 100_000;

interface QueuePayload {
  jobId: string;
}

interface ExportRowsResult {
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

@Injectable()
export class DataExportsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DataExportsService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: DataExportsRepository,
    @Optional()
    @Inject(queueConfig.KEY)
    private readonly runtimeQueueConfig?: ConfigType<typeof queueConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = this.queueRuntimeConfig();
    if (config.requireRedis && !config.redisUrl) {
      throw new Error('REDIS_URL is required for production data export queue processing');
    }
    if (config.redisUrl) {
      await this.initializeQueue(config);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const results = await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`Failed to close data export queue: ${this.errorMessage(result.reason)}`);
      }
    }
  }

  getCatalog(actor: AuthenticatedRequestUser) {
    const items = DATA_EXPORT_CATALOG.filter((item) => this.canAccessCatalogItem(actor, item));

    return {
      success: true as const,
      data: items,
    };
  }

  async createJob(actor: AuthenticatedRequestUser, dto: CreateDataExportJobDto) {
    const item = this.requireAsyncDataset(actor, dto.datasetCode);
    const bundle = item.fieldBundles.find((candidate) => candidate.code === dto.fieldBundleCode);
    if (!bundle) {
      throw new BadRequestException('ชุดข้อมูลส่งออกไม่ถูกต้อง');
    }
    const filters = this.normalizeFilters(item, dto.filters ?? {});
    const job = await this.repository.createJob({
      id: randomUUID(),
      datasetCode: item.code,
      fieldBundleCode: bundle.code,
      sensitivityClass: item.sensitivityClass,
      requestedBy: actor.id,
      scopeSnapshot: { ...(actor.data_scope ?? {}) },
      filterSnapshot: filters,
      purposeCode: dto.purposeCode?.trim() || null,
      purposeNote: dto.purposeNote?.trim() || null,
    });
    await this.repository.addEvent(job.id, actor.id, 'REQUESTED', {
      datasetCode: item.code,
      fieldBundleCode: bundle.code,
      filterKeys: Object.keys(filters),
    });
    await this.dispatchJob(job.id);
    return { success: true as const, data: this.toJobResponse(job) };
  }

  async listJobs(actor: AuthenticatedRequestUser, query: DataExportJobListQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const result = await this.repository.listJobs({
      requestedBy: actor.id,
      status: query.status,
      page,
      limit,
    });
    return {
      success: true as const,
      data: result.rows.map((row) => this.toJobResponse(row)),
      meta: { page, limit, total: result.totalCount },
    };
  }

  async getJob(actor: AuthenticatedRequestUser, jobId: string) {
    const job = await this.requireVisibleJob(actor, jobId);
    return { success: true as const, data: this.toJobResponse(job) };
  }

  async cancelJob(actor: AuthenticatedRequestUser, jobId: string) {
    const job = await this.requireVisibleJob(actor, jobId);
    const canceled = await this.repository.cancelJob(job.id);
    if (!canceled) {
      throw new BadRequestException('งานนี้ไม่อยู่ในสถานะที่ยกเลิกได้');
    }
    await this.repository.addEvent(job.id, actor.id, 'CANCELED', { previousStatus: job.status });
    return { success: true as const, data: this.toJobResponse(canceled) };
  }

  async retryJob(actor: AuthenticatedRequestUser, jobId: string) {
    const job = await this.requireVisibleJob(actor, jobId);
    if (job.status !== 'FAILED') {
      throw new BadRequestException('retry ได้เฉพาะงานที่ล้มเหลว');
    }
    await this.dispatchRetry(job.id);
    await this.repository.addEvent(job.id, actor.id, 'RETRIED', { previousStatus: job.status });
    const refreshed = (await this.repository.findJobById(job.id)) ?? job;
    return { success: true as const, data: this.toJobResponse(refreshed) };
  }

  async downloadJob(actor: AuthenticatedRequestUser, jobId: string): Promise<StreamableFile> {
    const job = await this.requireVisibleJob(actor, jobId);
    if (job.status !== 'COMPLETED' || !job.artifact_storage_key) {
      throw new BadRequestException('ไฟล์ส่งออกยังไม่พร้อมดาวน์โหลด');
    }
    if (job.expires_at && new Date(job.expires_at).getTime() < Date.now()) {
      throw new BadRequestException('ไฟล์ส่งออกหมดอายุแล้ว กรุณาสร้างงานใหม่');
    }
    const filePath = this.resolveArtifactPath(job.artifact_storage_key);
    await stat(filePath);
    await this.repository.addEvent(job.id, actor.id, 'DOWNLOADED', {
      datasetCode: job.dataset_code,
      rowCount: Number(job.exported_row_count ?? 0),
    });
    return new StreamableFile(createReadStream(filePath), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${job.dataset_code}-${job.id}.csv"`,
    });
  }

  private queueRuntimeConfig(): ConfigType<typeof queueConfig> {
    return (
      this.runtimeQueueConfig ?? {
        redisUrl: undefined,
        requireRedis: false,
        studentAccountBatch: {
          queueName: 'student-account-batch',
          attempts: 3,
          backoffMs: 30_000,
        },
        riskProfile: {
          queueName: 'student-risk-profile',
          attempts: 3,
          backoffMs: 30_000,
        },
        dataExport: {
          queueName: 'data-export',
          attempts: 3,
          backoffMs: 30_000,
          artifactTtlHours: 24,
          storagePrefix: 'data-exports/',
        },
      }
    );
  }

  private async initializeQueue(config: ConfigType<typeof queueConfig>): Promise<void> {
    if (!config.redisUrl) {
      throw new Error('Redis URL is required for data export queue processing');
    }
    const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(config.dataExport.queueName, {
      connection,
      defaultJobOptions: {
        attempts: config.dataExport.attempts,
        backoff: { type: 'exponential', delay: config.dataExport.backoffMs },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
    this.worker = new Worker(
      config.dataExport.queueName,
      async (job) => {
        const payload = job.data as QueuePayload;
        await this.processJob(payload.jobId);
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      const payload = job?.data as Partial<QueuePayload> | undefined;
      this.logger.error(
        `Data export queue job ${payload?.jobId ?? job?.id ?? 'unknown'} failed: ${this.errorMessage(error)}`,
      );
    });
    this.worker.on('error', (error) => {
      this.logger.error(`Data export queue error: ${this.errorMessage(error)}`);
    });
    await Promise.all([this.queue.waitUntilReady(), this.worker.waitUntilReady()]);
    this.logger.log(`Data export queue enabled (${config.dataExport.queueName})`);
  }

  private async dispatchJob(jobId: string): Promise<void> {
    if (!this.queue) {
      await this.repository.failJob(
        jobId,
        'QUEUE_NOT_READY',
        'ระบบคิวส่งออกข้อมูลยังไม่พร้อม กรุณาลองใหม่ภายหลัง',
      );
      throw new BadRequestException('ระบบคิวส่งออกข้อมูลยังไม่พร้อม กรุณาลองใหม่ภายหลัง');
    }
    try {
      await this.queue.add('process', { jobId }, { jobId });
    } catch (error) {
      await this.repository.failJob(
        jobId,
        'QUEUE_DISPATCH_FAILED',
        'ส่งงานเข้าคิวไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      );
      this.logger.error(`Failed to dispatch data export job ${jobId}: ${this.errorMessage(error)}`);
      throw new BadRequestException('ส่งงานเข้าคิวไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
    }
  }

  private async dispatchRetry(jobId: string): Promise<void> {
    if (!this.queue) {
      throw new BadRequestException('ระบบคิวส่งออกข้อมูลยังไม่พร้อม กรุณาลองใหม่ภายหลัง');
    }
    const queueJob = await this.queue.getJob(jobId);
    if (queueJob) {
      const state = await queueJob.getState();
      if (state !== 'failed') {
        throw new BadRequestException('งานนี้ยังอยู่ในคิวและไม่สามารถ retry ซ้ำได้');
      }
    }
    const prepared = await this.repository.prepareRetry(jobId);
    if (!prepared) {
      throw new BadRequestException('งานนี้ไม่อยู่ในสถานะที่ retry ได้');
    }
    try {
      if (queueJob) {
        await queueJob.retry();
      } else {
        await this.queue.add('process', { jobId }, { jobId });
      }
    } catch (error) {
      await this.repository.failJob(
        jobId,
        'QUEUE_DISPATCH_FAILED',
        'ส่งงานเข้าคิวไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      );
      this.logger.error(`Failed to retry data export job ${jobId}: ${this.errorMessage(error)}`);
      throw new BadRequestException('ส่งงานเข้าคิวไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const claimed = await this.repository.claimJob(jobId);
    if (!claimed) {
      return;
    }
    await this.repository.addEvent(jobId, claimed.requested_by, 'STARTED', {
      datasetCode: claimed.dataset_code,
    });
    try {
      const item = DATA_EXPORT_CATALOG.find((candidate) => candidate.code === claimed.dataset_code);
      if (!item || item.deliveryMode !== 'ASYNC_JOB') {
        throw new Error('Unsupported data export dataset');
      }
      const result = await this.loadRows(item, claimed);
      if (result.rows.length > ROW_CAP) {
        throw new Error('ROW_CAP_EXCEEDED');
      }
      const csv = this.toCsv(result.headers, result.rows);
      const artifactStorageKey = `${this.queueRuntimeConfig().dataExport.storagePrefix}${claimed.id}.csv`;
      const artifactPath = this.resolveArtifactPath(artifactStorageKey);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, csv, 'utf8');
      const digest = createHash('sha256').update(csv).digest('hex');
      const size = Buffer.byteLength(csv, 'utf8');
      const expiresAt = new Date(
        Date.now() + this.queueRuntimeConfig().dataExport.artifactTtlHours * 60 * 60 * 1000,
      );
      const completed = await this.repository.completeJob(claimed.id, {
        rowCount: result.rows.length,
        artifactSizeBytes: size,
        artifactStorageKey,
        artifactSha256: digest,
        expiresAt,
      });
      if (!completed) {
        await unlink(artifactPath).catch(() => undefined);
        return;
      }
      await this.repository.addEvent(jobId, claimed.requested_by, 'COMPLETED', {
        datasetCode: claimed.dataset_code,
        rowCount: result.rows.length,
        byteCount: size,
      });
    } catch (error) {
      const code =
        this.errorMessage(error) === 'ROW_CAP_EXCEEDED' ? 'ROW_CAP_EXCEEDED' : 'EXPORT_FAILED';
      await this.repository.failJob(
        jobId,
        code,
        code === 'ROW_CAP_EXCEEDED'
          ? 'จำนวนแถวเกินขีดจำกัด กรุณาลดช่วงเวลาหรือเพิ่มตัวกรอง'
          : 'สร้างไฟล์ส่งออกไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      );
      await this.repository.addEvent(jobId, claimed.requested_by, 'FAILED', {
        datasetCode: claimed.dataset_code,
        failureCode: code,
      });
      throw error;
    }
  }

  private canAccessCatalogItem(actor: AuthenticatedRequestUser, item: DataExportCatalogItem) {
    if (actor.data_scope?.own_only === true) {
      return false;
    }
    return item.requiredPermissions.every((permission) =>
      hasPermission(actor.roles || [], actor.permissions || [], permission),
    );
  }

  private requireAsyncDataset(actor: AuthenticatedRequestUser, datasetCode: string) {
    const item = DATA_EXPORT_CATALOG.find((candidate) => candidate.code === datasetCode);
    if (!item) {
      throw new BadRequestException('ไม่พบชุดข้อมูลส่งออกนี้');
    }
    if (!this.canAccessCatalogItem(actor, item)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ส่งออกชุดข้อมูลนี้');
    }
    if (item.deliveryMode !== 'ASYNC_JOB') {
      throw new BadRequestException(
        'ชุดข้อมูลนี้ใช้ workflow เฉพาะ ไม่สามารถสร้าง generic job ได้',
      );
    }
    return item;
  }

  private async requireVisibleJob(
    actor: AuthenticatedRequestUser,
    jobId: string,
  ): Promise<DataExportJobRow> {
    const job = await this.repository.findJobById(jobId);
    if (!job) {
      throw new NotFoundException('ไม่พบงานส่งออกข้อมูล');
    }
    if (job.requested_by !== actor.id) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูงานส่งออกนี้');
    }
    const item = DATA_EXPORT_CATALOG.find((candidate) => candidate.code === job.dataset_code);
    if (!item || !this.canAccessCatalogItem(actor, item)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูงานส่งออกนี้');
    }
    return job;
  }

  private normalizeFilters(item: DataExportCatalogItem, filters: Record<string, unknown>) {
    const allowed = new Set(
      item.supportedFilters.flatMap((filter) =>
        filter === 'dateRange' ? ['dateFrom', 'dateTo'] : [filter],
      ),
    );
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!allowed.has(key)) {
        throw new BadRequestException(`ตัวกรองไม่รองรับ: ${key}`);
      }
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (key === 'schoolId') {
        if (!Number.isInteger(value) || Number(value) <= 0) {
          throw new BadRequestException('schoolId ต้องเป็นจำนวนเต็มบวก');
        }
      } else if (key === 'dateFrom' || key === 'dateTo') {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new BadRequestException(`${key} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
        }
        const parsedDate = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
          throw new BadRequestException(`${key} ต้องเป็นวันที่ที่มีอยู่จริง`);
        }
      } else if (typeof value !== 'string' || value.trim().length === 0 || value.length > 100) {
        throw new BadRequestException(`ค่าตัวกรอง ${key} ไม่ถูกต้อง`);
      }
      normalized[key] = typeof value === 'string' ? value.trim() : value;
    }
    if (normalized.district && !normalized.province) {
      throw new BadRequestException('ต้องเลือกจังหวัดก่อนอำเภอ');
    }
    if (normalized.subDistrict && !normalized.district) {
      throw new BadRequestException('ต้องเลือกอำเภอก่อนตำบล');
    }
    if (normalized.room && !normalized.grade) {
      throw new BadRequestException('ต้องเลือกระดับชั้นก่อนห้อง');
    }
    if (
      typeof normalized.dateFrom === 'string' &&
      typeof normalized.dateTo === 'string' &&
      normalized.dateFrom > normalized.dateTo
    ) {
      throw new BadRequestException('dateFrom ต้องไม่อยู่หลัง dateTo');
    }
    return normalized;
  }

  private buildStudentScopeWhere(
    actorScope: unknown,
    filters: Record<string, unknown>,
    startIndex = 1,
  ) {
    const normalizedScope = normalizeDataScope(actorScope);
    if (
      !normalizedScope ||
      normalizedScope.own_only === true ||
      isUnconfiguredDataScope(normalizedScope)
    ) {
      return { sql: '1=0', params: [] as unknown[] };
    }
    const params: unknown[] = [];
    const conditions: string[] = [];
    const scope = buildDataScopeQuery(
      normalizedScope,
      {
        school_id: `s."SchoolID_Onec"`,
        grade: `s."GradeLevelID_Onec"`,
        room: `s."RoomID_Onec"::text`,
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      startIndex,
    );
    if (scope.sql) {
      conditions.push(`(${scope.sql})`);
      params.push(...scope.params);
    }
    let index = startIndex + params.length;
    for (const [key, column] of [
      ['province', 'sc.province'],
      ['district', 'sc.district'],
      ['subDistrict', 'sc.sub_district'],
      ['schoolId', 's."SchoolID_Onec"'],
      ['grade', 'gl.label'],
      ['room', 's."RoomID_Onec"::text'],
    ] as const) {
      if (filters[key]) {
        conditions.push(`${column} = $${index++}`);
        params.push(filters[key]);
      }
    }
    return { sql: conditions.join(' AND '), params };
  }

  private buildCaseScopeWhere(
    actorScope: unknown,
    filters: Record<string, unknown>,
    startIndex = 1,
  ) {
    const normalizedScope = normalizeDataScope(actorScope);
    if (
      !normalizedScope ||
      normalizedScope.own_only === true ||
      isUnconfiguredDataScope(normalizedScope)
    ) {
      return { sql: '1=0', params: [] as unknown[] };
    }
    const params: unknown[] = [];
    const conditions: string[] = [];
    const { grade_levels: gradeLevels, room_ids: roomIds, ...areaScope } = normalizedScope;
    const scope = buildDataScopeQuery(
      areaScope,
      {
        school_id: 'c.school_id',
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      startIndex,
    );
    if (scope.sql) {
      conditions.push(`(${scope.sql})`);
      params.push(...scope.params);
    }
    let index = startIndex + params.length;
    if ((gradeLevels?.length ?? 0) > 0 || (roomIds?.length ?? 0) > 0) {
      const enrollmentConditions = [
        'case_scope_student.student_uuid = c.student_uuid',
        `case_scope_current.selected_student_uuid = case_scope_student.student_uuid`,
        `case_scope_current.person_uuid = case_scope_student.person_uuid`,
        `case_scope_current.resolution_state = 'ACTIVE'`,
      ];
      if (gradeLevels?.length) {
        enrollmentConditions.push(
          `case_scope_student."GradeLevelID_Onec" = ANY($${index++}::int[])`,
        );
        params.push(gradeLevels);
      }
      if (roomIds?.length) {
        enrollmentConditions.push(
          `case_scope_student."RoomID_Onec"::text = ANY($${index++}::text[])`,
        );
        params.push(roomIds.map(String));
      }
      conditions.push(`EXISTS (
        SELECT 1
        FROM student_term case_scope_student
        JOIN student_current_enrollment_resolution case_scope_current
          ON case_scope_current.person_uuid = case_scope_student.person_uuid
        WHERE ${enrollmentConditions.join(' AND ')}
      )`);
    }
    for (const [key, column] of [
      ['province', 'sc.province'],
      ['district', 'sc.district'],
      ['subDistrict', 'sc.sub_district'],
      ['schoolId', 'c.school_id'],
    ] as const) {
      if (filters[key]) {
        conditions.push(`${column} = $${index++}`);
        params.push(filters[key]);
      }
    }
    if (filters.status) {
      conditions.push(`c.status = $${index++}`);
      params.push(filters.status);
    }
    return { sql: conditions.join(' AND '), params };
  }

  private async loadRows(
    item: DataExportCatalogItem,
    job: DataExportJobRow,
  ): Promise<ExportRowsResult> {
    switch (item.code) {
      case 'student_roster_basic':
        return await this.loadStudentRoster(job);
      case 'student_risk':
        return await this.loadStudentRisk(job);
      case 'attendance_summary':
        return await this.loadAttendanceSummary(job);
      case 'case_summary':
        return await this.loadCaseSummary(job);
      case 'case_operational':
        return await this.loadCaseOperational(job);
      default:
        throw new Error('Unsupported data export dataset');
    }
  }

  private async loadStudentRoster(job: DataExportJobRow): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const whereSql = scope.sql ? `WHERE ${scope.sql}` : '';
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT s.student_uuid::text, s."FirstName_Onec" AS first_name, s."LastName_Onec" AS last_name,
               sc.name AS school_name, gl.label AS grade, s."RoomID_Onec"::text AS room,
               COALESCE(status.label_th, s.student_status_code::text) AS student_status
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN student_status status ON status.code = s.student_status_code
        ${whereSql}
        ORDER BY sc.name NULLS LAST, gl.id NULLS LAST, s."RoomID_Onec" NULLS LAST, s."FirstName_Onec"
        LIMIT ${ROW_CAP + 1}
      `,
      scope.params,
    );
    return {
      headers: [
        'student_uuid',
        'first_name',
        'last_name',
        'school_name',
        'grade',
        'room',
        'student_status',
      ],
      rows: result.rows,
    };
  }

  private async loadStudentRisk(job: DataExportJobRow): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const conditions = [scope.sql];
    const params = [...scope.params];
    if (job.filter_snapshot.riskTier) {
      params.push(job.filter_snapshot.riskTier);
      conditions.push(`profile.risk_tier = $${params.length}`);
    }
    const whereSql = conditions.filter(Boolean).join(' AND ') || 'TRUE';
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT s.student_uuid::text, s."FirstName_Onec" AS first_name, s."LastName_Onec" AS last_name,
               sc.name AS school_name, gl.label AS grade, s."RoomID_Onec"::text AS room,
               profile.risk_tier, profile.consecutive_absent_days, profile.absent_days,
               profile.late_count, profile.weighted_attendance_percent, profile.open_case_count,
               profile.profile_calculated_at
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        WHERE ${whereSql}
        ORDER BY profile.risk_severity DESC NULLS LAST, profile.risk_score DESC NULLS LAST, s.student_uuid
        LIMIT ${ROW_CAP + 1}
      `,
      params,
    );
    return {
      headers: [
        'student_uuid',
        'first_name',
        'last_name',
        'school_name',
        'grade',
        'room',
        'risk_tier',
        'consecutive_absent_days',
        'absent_days',
        'late_count',
        'weighted_attendance_percent',
        'open_case_count',
        'profile_calculated_at',
      ],
      rows: result.rows,
    };
  }

  private async loadAttendanceSummary(job: DataExportJobRow): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const params = [...scope.params];
    const conditions = [
      scope.sql,
      `a."AttendanceDate" >= COALESCE($${params.length + 1}::date, CURRENT_DATE - interval '30 days')`,
      `a."AttendanceDate" <= COALESCE($${params.length + 2}::date, CURRENT_DATE)`,
    ];
    params.push(job.filter_snapshot.dateFrom ?? null, job.filter_snapshot.dateTo ?? null);
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT a."AttendanceDate"::text AS attendance_date,
               COUNT(*)::int AS total_records,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 1)::int AS present_count,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 2)::int AS absent_count,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 3)::int AS late_count
        FROM attendance a
        JOIN student_term s ON s.student_uuid = a.student_uuid
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        WHERE ${conditions.filter(Boolean).join(' AND ')}
        GROUP BY a."AttendanceDate"
        ORDER BY a."AttendanceDate"
        LIMIT ${ROW_CAP + 1}
      `,
      params,
    );
    return {
      headers: ['attendance_date', 'total_records', 'present_count', 'absent_count', 'late_count'],
      rows: result.rows,
    };
  }

  private async loadCaseSummary(job: DataExportJobRow): Promise<ExportRowsResult> {
    const scope = this.buildCaseScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const whereSql = ['c.deleted_at IS NULL', scope.sql].filter(Boolean).join(' AND ');
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT c.status, COUNT(*)::int AS case_count
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        WHERE ${whereSql}
        GROUP BY c.status
        ORDER BY c.status
        LIMIT ${ROW_CAP + 1}
      `,
      scope.params,
    );
    return { headers: ['status', 'case_count'], rows: result.rows };
  }

  private async loadCaseOperational(job: DataExportJobRow): Promise<ExportRowsResult> {
    const scope = this.buildCaseScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const whereSql = ['c.deleted_at IS NULL', scope.sql].filter(Boolean).join(' AND ');
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT c.id AS case_id, c.student_uuid::text, c.student_first_name, c.student_last_name,
               sc.name AS school_name, c.status, c.reason_flagged, c.created_at, c.sla_due_at,
               latest_referral.status AS latest_referral_status,
               latest_referral.outcome AS latest_referral_outcome
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        LEFT JOIN LATERAL (
          SELECT referral.status, referral.outcome
          FROM case_referrals referral
          WHERE referral.case_id = c.id AND referral.deleted_at IS NULL
          ORDER BY referral.referred_at DESC
          LIMIT 1
        ) latest_referral ON TRUE
        WHERE ${whereSql}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${ROW_CAP + 1}
      `,
      scope.params,
    );
    return {
      headers: [
        'case_id',
        'student_uuid',
        'student_first_name',
        'student_last_name',
        'school_name',
        'status',
        'reason_flagged',
        'created_at',
        'sla_due_at',
        'latest_referral_status',
        'latest_referral_outcome',
      ],
      rows: result.rows,
    };
  }

  private toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((header) => this.csvCell(row[header])).join(','));
    }
    return `\uFEFF${lines.join('\n')}\n`;
  }

  private csvCell(value: unknown) {
    if (value === null || value === undefined) {
      return '';
    }
    let text: string;
    if (value instanceof Date) {
      text = value.toISOString();
    } else if (typeof value === 'string') {
      text = value;
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      text = value.toString();
    } else if (typeof value === 'object') {
      text = JSON.stringify(value);
    } else {
      text = '';
    }
    if (/^[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  private resolveArtifactPath(storageKey: string) {
    const normalized = storageKey.replace(/^\/+/, '');
    if (normalized.includes('..')) {
      throw new BadRequestException('artifact path ไม่ถูกต้อง');
    }
    return path.join(process.cwd(), '.data-export-artifacts', normalized);
  }

  private toJobResponse(row: DataExportJobRow): DataExportJobResponse {
    return {
      id: row.id,
      datasetCode: row.dataset_code,
      fieldBundleCode: row.field_bundle_code,
      outputFormat: row.output_format,
      sensitivityClass: row.sensitivity_class,
      status: row.status,
      progressPercent: Number(row.progress_percent),
      exportedRowCount: row.exported_row_count === null ? null : Number(row.exported_row_count),
      artifactSizeBytes: row.artifact_size_bytes === null ? null : Number(row.artifact_size_bytes),
      failureCode: row.failure_code,
      failureSummary: row.failure_summary,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
