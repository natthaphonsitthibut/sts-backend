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
import { Cron } from '@nestjs/schedule';
import type { ConfigType } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { Queue, Worker } from 'bullmq';
import { Readable } from 'stream';
import { DataSource } from 'typeorm';
import { hasPermission, isRestrictedExecutive, type AuthenticatedRequestUser } from '../auth';
import { isUnconfiguredDataScope, normalizeDataScope, type DataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { appConfig } from '../config/app.config';
import { queueConfig } from '../config/queue.config';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
import { AttendanceService } from '../attendance/attendance.service';
import { StatusCatalogService } from '../status-catalog/status-catalog.service';
import { DATA_EXPORT_CATALOG } from './data-export.registry';
import { DataExportsRepository, type DataExportActorRow } from './data-exports.repository';
import type { CreateDataExportJobDto, DataExportJobListQueryDto } from './dto/data-export.dto';
import type {
  DataExportCatalogItem,
  DataExportJobResponse,
  DataExportJobRow,
} from './data-export.types';

const ROW_CAP = 100_000;
const QUERY_CHUNK_SIZE = 1_000;
const EXPORT_EXPIRY_CRON = '0 */15 * * * *';

interface QueuePayload {
  jobId: string;
}

interface ExportRowsResult {
  headers: string[];
  nextCursor: ExportCursor | null;
  rows: Array<Record<string, unknown>>;
}

type ExportCursor = Record<string, string | number>;

interface ExportStreamMetrics {
  byteCount: number;
  rowCount: number;
  sha256: ReturnType<typeof createHash>;
}

@Injectable()
export class DataExportsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DataExportsService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: DataExportsRepository,
    private readonly attendanceService: AttendanceService,
    private readonly statusCatalogService: StatusCatalogService,
    @Optional()
    @Inject(queueConfig.KEY)
    private readonly runtimeQueueConfig?: ConfigType<typeof queueConfig>,
    @Optional()
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage?: FileStorageAdapter,
    @Optional()
    @Inject(appConfig.KEY)
    private readonly runtimeAppConfig?: ConfigType<typeof appConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.runtimeAppConfig?.isProduction && this.storage?.kind !== 'private-object') {
      throw new Error(
        'Production data exports require private object storage; local artifact storage is disabled',
      );
    }
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

  async getCatalog(actor: AuthenticatedRequestUser) {
    const accessibleItems = DATA_EXPORT_CATALOG.filter((item) =>
      this.canAccessCatalogItem(actor, item),
    );
    const needsSchoolOptions = accessibleItems.some((item) =>
      item.filterDefinitions.some((definition) => definition.key === 'schoolId'),
    );
    const needsCaseStatuses = accessibleItems.some((item) =>
      item.filterDefinitions.some((definition) => definition.key === 'status'),
    );
    const [schools, caseStatuses] = await Promise.all([
      needsSchoolOptions
        ? this.attendanceService.getSchools(
            undefined,
            undefined,
            undefined,
            undefined,
            ROW_CAP,
            actor.data_scope,
          )
        : Promise.resolve({ success: true as const, data: [] }),
      needsCaseStatuses
        ? this.statusCatalogService.getCatalog('CASE_WORKFLOW')
        : Promise.resolve([]),
    ]);
    const items = accessibleItems.map((item) => ({
      ...item,
      filterDefinitions: item.filterDefinitions.map((definition) =>
        definition.key === 'schoolId'
          ? {
              ...definition,
              label: 'โรงเรียน',
              control: 'SELECT' as const,
              options: schools.data.map((school) => ({
                value: String(school.id),
                label: school.name ?? `โรงเรียน ${school.id}`,
              })),
            }
          : definition.key === 'status'
            ? {
                ...definition,
                control: 'SELECT' as const,
                options: caseStatuses.map((status) => ({
                  value: status.code,
                  label: status.label,
                })),
              }
            : definition,
      ),
      supportedFilters:
        item.deliveryMode === 'ASYNC_JOB'
          ? item.filterDefinitions.map((definition) => definition.key)
          : item.supportedFilters,
    }));

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
    if (!this.currentScopeCoversFilters(actor.data_scope, filters)) {
      throw new ForbiddenException('ตัวกรองอยู่นอกขอบเขตข้อมูลปัจจุบัน');
    }
    this.assertPurposePolicy(item, dto.purposeCode, dto.purposeNote);
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
    const stream = await this.requireStorage().open(job.artifact_storage_key);
    if (!stream) {
      throw new NotFoundException('ไม่พบไฟล์ส่งออก กรุณาสร้างงานใหม่');
    }
    await this.repository.addEvent(job.id, actor.id, 'DOWNLOADED', {
      datasetCode: job.dataset_code,
      rowCount: Number(job.exported_row_count ?? 0),
    });
    return new StreamableFile(stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${job.dataset_code}-${job.id}.csv"`,
    });
  }

  private queueRuntimeConfig(): ConfigType<typeof queueConfig> {
    return (
      this.runtimeQueueConfig ?? {
        redisUrl: undefined,
        requireRedis: false,
        failedJobRetention: {
          ageSeconds: 7 * 24 * 60 * 60,
          count: 1_000,
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
        removeOnFail: {
          age: config.failedJobRetention.ageSeconds,
          count: config.failedJobRetention.count,
        },
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
    let artifactStorageKey: string | null = null;
    try {
      const currentActor = await this.loadCurrentRequester(claimed.requested_by);
      const item = this.requireCurrentJobAccess(claimed, currentActor);
      const metrics: ExportStreamMetrics = {
        byteCount: 0,
        rowCount: 0,
        sha256: createHash('sha256'),
      };
      const storageKey = this.artifactStorageKey(claimed.id);
      artifactStorageKey = storageKey;
      await withDataSourceTransaction(
        this.dataSource,
        async () => {
          await this.requireStorage().saveStream(
            Readable.from(this.streamCsv(item, claimed, metrics)),
            storageKey,
          );
        },
        'REPEATABLE READ',
      );
      const digest = metrics.sha256.digest('hex');
      const expiresAt = new Date(
        Date.now() + this.queueRuntimeConfig().dataExport.artifactTtlHours * 60 * 60 * 1000,
      );
      const completed = await this.repository.completeJob(claimed.id, {
        rowCount: metrics.rowCount,
        artifactSizeBytes: metrics.byteCount,
        artifactStorageKey,
        artifactSha256: digest,
        expiresAt,
      });
      if (!completed) {
        await this.requireStorage()
          .delete(artifactStorageKey)
          .catch(() => undefined);
        return;
      }
      await this.repository.addEvent(jobId, claimed.requested_by, 'COMPLETED', {
        datasetCode: claimed.dataset_code,
        rowCount: metrics.rowCount,
        byteCount: metrics.byteCount,
      });
    } catch (error) {
      if (artifactStorageKey) {
        await this.requireStorage()
          .delete(artifactStorageKey)
          .catch(() => undefined);
      }
      if (this.errorMessage(error) === 'EXPORT_JOB_STOPPED') {
        return;
      }
      const accessRevoked =
        error instanceof ForbiddenException || error instanceof BadRequestException;
      const code = accessRevoked
        ? 'EXPORT_ACCESS_REVOKED'
        : this.errorMessage(error) === 'ROW_CAP_EXCEEDED'
          ? 'ROW_CAP_EXCEEDED'
          : 'EXPORT_FAILED';
      await this.repository.failJob(
        jobId,
        code,
        code === 'EXPORT_ACCESS_REVOKED'
          ? 'สิทธิ์ ขอบเขตข้อมูล หรือวัตถุประสงค์ของผู้ขอไม่อนุญาตให้ประมวลผลงานนี้แล้ว'
          : code === 'ROW_CAP_EXCEEDED'
            ? 'จำนวนแถวเกินขีดจำกัด กรุณาลดช่วงเวลาหรือเพิ่มตัวกรอง'
            : 'สร้างไฟล์ส่งออกไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      );
      await this.repository.addEvent(jobId, claimed.requested_by, 'FAILED', {
        datasetCode: claimed.dataset_code,
        failureCode: code,
      });
      if (accessRevoked) return;
      throw error;
    }
  }

  private canAccessCatalogItem(actor: AuthenticatedRequestUser, item: DataExportCatalogItem) {
    if (isRestrictedExecutive(actor)) {
      return false;
    }
    if (actor.data_scope?.own_only === true || isUnconfiguredDataScope(actor.data_scope)) {
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

  private normalizePermissionList(value: unknown): string[] {
    return Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (permission): permission is string =>
                typeof permission === 'string' && permission.trim().length > 0,
            ),
          ),
        )
      : [];
  }

  private async loadCurrentRequester(userId: number): Promise<AuthenticatedRequestUser | null> {
    const row = await this.repository.findActiveRequester(userId);
    if (!row) return null;
    return this.actorFromRow(row);
  }

  private actorFromRow(row: DataExportActorRow): AuthenticatedRequestUser {
    const storedPermissions = this.normalizePermissionList(row.permissions);
    const roleDefaults = this.normalizePermissionList(row.role_default_permissions);
    return {
      id: Number(row.id),
      username: row.username,
      roles: row.role ? [row.role] : [],
      permissions: Array.isArray(row.permissions) ? storedPermissions : roleDefaults,
      data_scope: normalizeDataScope(row.data_scope) ?? {},
    };
  }

  private requireCurrentJobAccess(
    job: DataExportJobRow,
    actor: AuthenticatedRequestUser | null,
  ): DataExportCatalogItem {
    if (!actor) {
      throw new ForbiddenException('ผู้ขอส่งออกไม่อยู่ในสถานะใช้งานแล้ว');
    }
    const item = DATA_EXPORT_CATALOG.find((candidate) => candidate.code === job.dataset_code);
    if (!item || item.deliveryMode !== 'ASYNC_JOB') {
      throw new BadRequestException('ชุดข้อมูลส่งออกไม่รองรับแล้ว');
    }
    if (!this.canAccessCatalogItem(actor, item)) {
      throw new ForbiddenException('สิทธิ์ส่งออกชุดข้อมูลถูกเพิกถอนแล้ว');
    }
    if (!this.scopeCoversSnapshot(actor.data_scope, job.scope_snapshot)) {
      throw new ForbiddenException('ขอบเขตข้อมูลปัจจุบันไม่ครอบคลุมขอบเขตเดิมของงาน');
    }
    const filters = this.normalizeFilters(item, job.filter_snapshot);
    if (!this.currentScopeCoversFilters(actor.data_scope, filters)) {
      throw new ForbiddenException('ตัวกรองเดิมอยู่นอกขอบเขตข้อมูลปัจจุบัน');
    }
    this.assertPurposePolicy(item, job.purpose_code, job.purpose_note);
    return item;
  }

  private scopeCoversSnapshot(currentScope: unknown, snapshotScope: unknown): boolean {
    const current = normalizeDataScope(currentScope);
    const snapshot = normalizeDataScope(snapshotScope);
    if (!current || current.own_only === true || isUnconfiguredDataScope(current)) return false;
    if (!snapshot || snapshot.own_only === true || isUnconfiguredDataScope(snapshot)) return false;
    if (current.global === true) return true;
    if (snapshot.global === true) return false;

    const keys: Array<keyof Omit<DataScope, 'global' | 'own_only'>> = [
      'provinces',
      'districts',
      'sub_districts',
      'school_ids',
      'grade_levels',
      'room_ids',
    ];
    for (const key of keys) {
      const currentValues = new Set((current[key] ?? []).map(String));
      const snapshotValues = (snapshot[key] ?? []).map(String);
      if (currentValues.size === 0) continue;
      if (
        snapshotValues.length === 0 ||
        !snapshotValues.every((value) => currentValues.has(value))
      ) {
        return false;
      }
    }
    return true;
  }

  private currentScopeCoversFilters(
    currentScope: unknown,
    filters: Record<string, unknown>,
  ): boolean {
    const current = normalizeDataScope(currentScope);
    if (!current || current.own_only === true || isUnconfiguredDataScope(current)) return false;
    if (current.global === true) return true;
    const constraints: Array<[string, keyof DataScope]> = [
      ['province', 'provinces'],
      ['district', 'districts'],
      ['subDistrict', 'sub_districts'],
      ['schoolId', 'school_ids'],
      ['room', 'room_ids'],
    ];
    return constraints.every(([filterKey, scopeKey]) => {
      const filterValue = filters[filterKey];
      const scopeValues = (current[scopeKey] as Array<string | number> | undefined) ?? [];
      if (
        filterValue !== undefined &&
        typeof filterValue !== 'string' &&
        typeof filterValue !== 'number'
      ) {
        return false;
      }
      return (
        filterValue === undefined ||
        scopeValues.length === 0 ||
        scopeValues.map(String).includes(String(filterValue))
      );
    });
  }

  private assertPurposePolicy(
    item: DataExportCatalogItem,
    purposeCode: string | null | undefined,
    purposeNote: string | null | undefined,
  ): void {
    if (item.purposePolicy !== 'REQUIRED_CODE_AND_NOTE') return;
    if (!purposeCode?.trim() || !purposeNote?.trim()) {
      throw new BadRequestException('ชุดข้อมูลนี้ต้องระบุรหัสวัตถุประสงค์และรายละเอียดการใช้งาน');
    }
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
    this.requireCurrentJobAccess(job, actor);
    return job;
  }

  private normalizeFilters(item: DataExportCatalogItem, filters: Record<string, unknown>) {
    const allowed = new Set(item.filterDefinitions.map((filter) => filter.key));
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filters)) {
      const definition = item.filterDefinitions.find((filter) => filter.key === key);
      if (!allowed.has(key) || !definition) {
        throw new BadRequestException(`ตัวกรองไม่รองรับ: ${key}`);
      }
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (definition.control === 'INTEGER') {
        if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 2_147_483_647) {
          throw new BadRequestException(`${key} ต้องเป็นจำนวนเต็มบวก`);
        }
      } else if (key === 'dateFrom' || key === 'dateTo') {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new BadRequestException(`${key} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
        }
        const parsedDate = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
          throw new BadRequestException(`${key} ต้องเป็นวันที่ที่มีอยู่จริง`);
        }
      } else if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value.length > 100 ||
        (definition.control === 'SELECT' &&
          !definition.options?.some((option) => option.value === value.trim()))
      ) {
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

  private buildSchoolAreaScopeWhere(
    actorScope: unknown,
    filters: Record<string, unknown>,
    schoolAlias = 'school',
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
    const areaScope = { ...normalizedScope };
    delete areaScope.grade_levels;
    delete areaScope.room_ids;
    const params: unknown[] = [];
    const conditions: string[] = [];
    const scope = buildDataScopeQuery(
      areaScope,
      {
        school_id: `${schoolAlias}.id`,
        province: `${schoolAlias}.province`,
        district: `${schoolAlias}.district`,
        sub_district: `${schoolAlias}.sub_district`,
      },
      startIndex,
    );
    if (scope.sql) {
      conditions.push(`(${scope.sql})`);
      params.push(...scope.params);
    }
    let index = startIndex + params.length;
    for (const [key, column] of [
      ['province', `${schoolAlias}.province`],
      ['district', `${schoolAlias}.district`],
      ['subDistrict', `${schoolAlias}.sub_district`],
      ['schoolId', `${schoolAlias}.id`],
    ] as const) {
      if (filters[key]) {
        conditions.push(`${column} = $${index++}`);
        params.push(filters[key]);
      }
    }
    return { sql: conditions.join(' AND '), params };
  }

  private async loadRows(
    item: DataExportCatalogItem,
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    switch (item.code) {
      case 'student_roster_basic':
        return await this.loadStudentRoster(job, limit, cursor);
      case 'student_risk':
        return await this.loadStudentRisk(job, limit, cursor);
      case 'attendance_summary':
        return await this.loadAttendanceSummary(job, limit, cursor);
      case 'case_summary':
        return await this.loadCaseSummary(job, limit, cursor);
      case 'case_operational':
        return await this.loadCaseOperational(job, limit, cursor);
      case 'school_teacher_roster':
        return await this.loadSchoolTeacherRoster(job, limit, cursor);
      case 'school_classroom_structure':
        return await this.loadSchoolClassroomStructure(job, limit, cursor);
      case 'classroom_assignments':
        return await this.loadClassroomAssignments(job, limit, cursor);
      default:
        throw new Error('Unsupported data export dataset');
    }
  }

  private async loadStudentRoster(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const params = [...scope.params];
    const conditions = [scope.sql];
    if (cursor?.studentUuid) {
      conditions.push(`s.student_uuid > $${params.push(cursor.studentUuid)}::uuid`);
    }
    params.push(limit);
    const whereSql = conditions.filter(Boolean).join(' AND ');
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
        WHERE ${whereSql || 'TRUE'}
        ORDER BY s.student_uuid
        LIMIT $${params.length}
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
        'student_status',
      ],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { studentUuid: 'student_uuid' }),
    };
  }

  private async loadStudentRisk(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const conditions = [scope.sql];
    const params = [...scope.params];
    if (job.filter_snapshot.riskTier) {
      params.push(job.filter_snapshot.riskTier);
      conditions.push(`profile.risk_tier = $${params.length}`);
    }
    if (cursor?.studentUuid) {
      conditions.push(`s.student_uuid > $${params.push(cursor.studentUuid)}::uuid`);
    }
    params.push(limit);
    const whereSql = conditions.filter(Boolean).join(' AND ') || 'TRUE';
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT s.student_uuid::text, s."FirstName_Onec" AS first_name, s."LastName_Onec" AS last_name,
               sc.name AS school_name, gl.label AS grade, s."RoomID_Onec"::text AS room,
               profile.risk_tier, profile.consecutive_absent_days, profile.term_absent_days,
               profile.absent_days_since_case_reset AS absent_days_since_case_reset, profile.absence_reset_after_date,
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
        ORDER BY s.student_uuid
        LIMIT $${params.length}
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
        'term_absent_days',
        'absent_days_since_case_reset',
        'absence_reset_after_date',
        'late_count',
        'weighted_attendance_percent',
        'open_case_count',
        'profile_calculated_at',
      ],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { studentUuid: 'student_uuid' }),
    };
  }

  private async loadAttendanceSummary(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildStudentScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const params = [...scope.params];
    const conditions = [
      scope.sql,
      `a."AttendanceDate" >= COALESCE($${params.length + 1}::date, CURRENT_DATE - interval '30 days')`,
      `a."AttendanceDate" <= COALESCE($${params.length + 2}::date, CURRENT_DATE)`,
    ];
    params.push(job.filter_snapshot.dateFrom ?? null, job.filter_snapshot.dateTo ?? null);
    if (cursor?.attendanceDate) {
      conditions.push(`a."AttendanceDate" > $${params.push(cursor.attendanceDate)}::date`);
    }
    params.push(limit);
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT a."AttendanceDate"::text AS attendance_date,
               COUNT(*)::int AS total_records,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 1)::int AS present_count,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 2)::int AS absent_count,
               COUNT(*) FILTER (WHERE a."AttendanceStatus" = 3)::int AS late_count
        FROM attendance_effective_records a
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
        LIMIT $${params.length}
      `,
      params,
    );
    return {
      headers: ['attendance_date', 'total_records', 'present_count', 'absent_count', 'late_count'],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { attendanceDate: 'attendance_date' }),
    };
  }

  private async loadCaseSummary(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildCaseScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const conditions = ['c.deleted_at IS NULL', scope.sql];
    const params = [...scope.params];
    if (job.filter_snapshot.dateFrom) {
      conditions.push(`c.created_at::date >= $${params.push(job.filter_snapshot.dateFrom)}::date`);
    }
    if (job.filter_snapshot.dateTo) {
      conditions.push(`c.created_at::date <= $${params.push(job.filter_snapshot.dateTo)}::date`);
    }
    if (cursor?.status) {
      conditions.push(`c.status > $${params.push(cursor.status)}`);
    }
    params.push(limit);
    const whereSql = conditions.filter(Boolean).join(' AND ');
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT c.status, COUNT(*)::int AS case_count
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        WHERE ${whereSql}
        GROUP BY c.status
        ORDER BY c.status
        LIMIT $${params.length}
      `,
      params,
    );
    return {
      headers: ['status', 'case_count'],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { status: 'status' }),
    };
  }

  private async loadCaseOperational(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildCaseScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const conditions = ['c.deleted_at IS NULL', scope.sql];
    const params = [...scope.params];
    if (job.filter_snapshot.dateFrom) {
      conditions.push(`c.created_at::date >= $${params.push(job.filter_snapshot.dateFrom)}::date`);
    }
    if (job.filter_snapshot.dateTo) {
      conditions.push(`c.created_at::date <= $${params.push(job.filter_snapshot.dateTo)}::date`);
    }
    if (cursor?.caseId) {
      conditions.push(`c.id > $${params.push(cursor.caseId)}::integer`);
    }
    params.push(limit);
    const whereSql = conditions.filter(Boolean).join(' AND ');
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT c.id AS case_id, c.student_uuid::text, c.student_first_name, c.student_last_name,
               sc.name AS school_name, c.status, c.reason_flagged, c.created_at, c.sla_due_at,
               latest_review.review_action AS latest_review_action,
               latest_review.resolution_outcome AS latest_resolution_outcome,
               latest_review.reviewed_at AS latest_reviewed_at
        FROM cases c
        LEFT JOIN schools sc ON sc.id = c.school_id
        LEFT JOIN LATERAL (
          SELECT review.review_action, review.resolution_outcome, review.reviewed_at
          FROM case_reviews review
          WHERE review.case_id = c.id
          ORDER BY review.reviewed_at DESC, review.id DESC
          LIMIT 1
        ) latest_review ON TRUE
        WHERE ${whereSql}
        ORDER BY c.id
        LIMIT $${params.length}
      `,
      params,
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
        'latest_review_action',
        'latest_resolution_outcome',
        'latest_reviewed_at',
      ],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { caseId: 'case_id' }),
    };
  }

  private async loadSchoolTeacherRoster(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildSchoolAreaScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const normalizedScope = normalizeDataScope(job.scope_snapshot);
    const conditions = ['membership.deleted_at IS NULL', scope.sql];
    const params = [...scope.params];
    if (job.filter_snapshot.structureStatus) {
      conditions.push(
        `membership.membership_status = $${params.push(job.filter_snapshot.structureStatus)}`,
      );
    }
    const gradeLevels = normalizedScope?.grade_levels ?? [];
    const roomIds = normalizedScope?.room_ids ?? [];
    if (gradeLevels.length > 0 || roomIds.length > 0) {
      const assignmentScope = [
        'scoped_assignment.teacher_membership_id = membership.id',
        'scoped_classroom.deleted_at IS NULL',
      ];
      if (gradeLevels.length > 0) {
        assignmentScope.push(`scoped_classroom.grade_level_id = ANY($${params.length + 1}::int[])`);
        params.push(gradeLevels);
      }
      if (roomIds.length > 0) {
        assignmentScope.push(
          `COALESCE(scoped_classroom.legacy_room_number::text, scoped_classroom.room_code)
            = ANY($${params.length + 1}::text[])`,
        );
        params.push(roomIds.map(String));
      }
      conditions.push(`EXISTS (
        SELECT 1
        FROM classroom_homeroom_teacher_assignments scoped_assignment
        JOIN school_classrooms scoped_classroom
          ON scoped_classroom.id = scoped_assignment.classroom_id
        WHERE ${assignmentScope.join(' AND ')}
      )`);
    }
    if (cursor?.membershipId) {
      conditions.push(`membership.id > $${params.push(cursor.membershipId)}::bigint`);
    }
    params.push(limit);
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT membership.id::text AS cursor_membership_id,
               school.name AS school_name,
               COALESCE(
                 NULLIF(TRIM(teacher.first_name || ' ' || teacher.last_name), ''),
                 'ไม่ระบุชื่อ'
               ) AS teacher_name
               membership.membership_status,
               membership.started_on::text,
               membership.ended_on::text
        FROM school_teacher_memberships membership
        JOIN schools school ON school.id = membership.school_id
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE ${conditions.filter(Boolean).join(' AND ')}
        ORDER BY membership.id
        LIMIT $${params.length}
      `,
      params,
    );
    return {
      headers: ['school_name', 'teacher_name', 'membership_status', 'started_on', 'ended_on'],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, {
        membershipId: 'cursor_membership_id',
      }),
    };
  }

  private async loadSchoolClassroomStructure(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildSchoolAreaScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const normalizedScope = normalizeDataScope(job.scope_snapshot);
    const conditions = ['classroom.deleted_at IS NULL', 'term.deleted_at IS NULL', scope.sql];
    const params = [...scope.params];
    const gradeLevels = normalizedScope?.grade_levels ?? [];
    const roomIds = normalizedScope?.room_ids ?? [];
    if (gradeLevels.length > 0) {
      conditions.push(`classroom.grade_level_id = ANY($${params.push(gradeLevels)}::int[])`);
    }
    if (roomIds.length > 0) {
      conditions.push(
        `COALESCE(classroom.legacy_room_number::text, classroom.room_code)
          = ANY($${params.push(roomIds.map(String))}::text[])`,
      );
    }
    for (const [key, sql] of [
      ['academicYear', 'term.academic_year'],
      ['semester', 'term.semester'],
      ['grade', 'grade.label'],
      ['room', 'classroom.room_code'],
      ['structureStatus', 'classroom.classroom_status'],
    ] as const) {
      if (job.filter_snapshot[key]) {
        conditions.push(`${sql} = $${params.push(job.filter_snapshot[key])}`);
      }
    }
    if (cursor?.classroomId) {
      conditions.push(`classroom.id > $${params.push(cursor.classroomId)}::bigint`);
    }
    params.push(limit);
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT classroom.id::text AS cursor_classroom_id,
               school.name AS school_name,
               term.academic_year,
               term.semester,
               grade.label AS grade,
               classroom.room_code,
               classroom.room_name,
               classroom.classroom_status,
               (
                 SELECT COUNT(*)::int
                 FROM student_term enrollment
                 WHERE enrollment.classroom_id = classroom.id
                   AND enrollment.deleted_at IS NULL
               ) AS student_count
        FROM school_classrooms classroom
        JOIN schools school ON school.id = classroom.school_id
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        WHERE ${conditions.filter(Boolean).join(' AND ')}
        ORDER BY classroom.id
        LIMIT $${params.length}
      `,
      params,
    );
    return {
      headers: [
        'school_name',
        'academic_year',
        'semester',
        'grade',
        'room_code',
        'room_name',
        'classroom_status',
        'student_count',
      ],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { classroomId: 'cursor_classroom_id' }),
    };
  }

  private async loadClassroomAssignments(
    job: DataExportJobRow,
    limit: number,
    cursor: ExportCursor | null,
  ): Promise<ExportRowsResult> {
    const scope = this.buildSchoolAreaScopeWhere(job.scope_snapshot, job.filter_snapshot);
    const normalizedScope = normalizeDataScope(job.scope_snapshot);
    const conditions = [
      'classroom.deleted_at IS NULL',
      'membership.deleted_at IS NULL',
      'term.deleted_at IS NULL',
      scope.sql,
    ];
    const params = [...scope.params];
    const gradeLevels = normalizedScope?.grade_levels ?? [];
    const roomIds = normalizedScope?.room_ids ?? [];
    if (gradeLevels.length > 0) {
      conditions.push(`classroom.grade_level_id = ANY($${params.push(gradeLevels)}::int[])`);
    }
    if (roomIds.length > 0) {
      conditions.push(
        `COALESCE(classroom.legacy_room_number::text, classroom.room_code)
          = ANY($${params.push(roomIds.map(String))}::text[])`,
      );
    }
    for (const [key, sql] of [
      ['academicYear', 'term.academic_year'],
      ['semester', 'term.semester'],
      ['grade', 'grade.label'],
      ['room', 'classroom.room_code'],
    ] as const) {
      if (job.filter_snapshot[key]) {
        conditions.push(`${sql} = $${params.push(job.filter_snapshot[key])}`);
      }
    }
    if (cursor?.assignmentId) {
      conditions.push(`assignment.classroom_id > $${params.push(cursor.assignmentId)}::bigint`);
    }
    params.push(limit);
    const result = await queryDataSource<Record<string, unknown>>(
      this.dataSource,
      `
        SELECT assignment.classroom_id::text AS cursor_assignment_id,
               school.name AS school_name,
               term.academic_year,
               term.semester,
               grade.label AS grade,
               classroom.room_code,
               classroom.room_name,
               string_agg(
                 COALESCE(
                   NULLIF(TRIM(teacher.first_name || ' ' || teacher.last_name), ''),
                   'ไม่ระบุชื่อ'
                 ),
                 ', ' ORDER BY assignment.is_primary DESC,
                 TRIM(teacher.first_name || ' ' || teacher.last_name)
               ) AS teacher_name
        FROM classroom_homeroom_teacher_assignments assignment
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
        JOIN schools school ON school.id = assignment.school_id
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE ${conditions.filter(Boolean).join(' AND ')}
        GROUP BY assignment.classroom_id, school.name, term.academic_year,
                 term.semester, grade.label, classroom.room_code, classroom.room_name
        ORDER BY assignment.classroom_id
        LIMIT $${params.length}
      `,
      params,
    );
    return {
      headers: [
        'school_name',
        'academic_year',
        'semester',
        'grade',
        'room_code',
        'room_name',
        'teacher_name',
      ],
      rows: result.rows,
      nextCursor: this.cursorFromLastRow(result.rows, { assignmentId: 'cursor_assignment_id' }),
    };
  }

  private async *streamCsv(
    item: DataExportCatalogItem,
    job: DataExportJobRow,
    metrics: ExportStreamMetrics,
  ): AsyncGenerator<Buffer> {
    let cursor: ExportCursor | null = null;
    let wroteHeader = false;
    while (true) {
      const remaining = ROW_CAP - metrics.rowCount;
      const limit = Math.min(QUERY_CHUNK_SIZE, remaining + 1);
      const result = await this.loadRows(item, job, limit, cursor);
      if (!wroteHeader) {
        wroteHeader = true;
        yield this.trackCsvChunk(`\uFEFF${result.headers.join(',')}\n`, metrics);
      }
      if (metrics.rowCount + result.rows.length > ROW_CAP) {
        throw new Error('ROW_CAP_EXCEEDED');
      }
      if (result.rows.length === 0) {
        break;
      }
      const lines = result.rows.map((row) =>
        result.headers.map((header) => this.csvCell(row[header])).join(','),
      );
      yield this.trackCsvChunk(`${lines.join('\n')}\n`, metrics);
      metrics.rowCount += result.rows.length;
      cursor = result.nextCursor;
      const currentJob = await this.repository.findJobById(job.id);
      if (!currentJob || currentJob.status !== 'RUNNING') {
        throw new Error('EXPORT_JOB_STOPPED');
      }
      if (result.rows.length < limit) {
        break;
      }
      if (!cursor) {
        throw new Error('EXPORT_CURSOR_MISSING');
      }
    }
  }

  private cursorFromLastRow(
    rows: Array<Record<string, unknown>>,
    fields: Record<string, string>,
  ): ExportCursor | null {
    const last = rows.at(-1);
    if (!last) return null;
    const cursor: ExportCursor = {};
    for (const [cursorKey, rowKey] of Object.entries(fields)) {
      const value = last[rowKey];
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error('EXPORT_CURSOR_INVALID');
      }
      cursor[cursorKey] = value;
    }
    return cursor;
  }

  private trackCsvChunk(csv: string, metrics: ExportStreamMetrics): Buffer {
    const chunk = Buffer.from(csv, 'utf8');
    metrics.sha256.update(chunk);
    metrics.byteCount += chunk.byteLength;
    return chunk;
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
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  private artifactStorageKey(jobId: string): string {
    const prefix = this.queueRuntimeConfig().dataExport.storagePrefix.replace(/^\/+|\/+$/g, '');
    if (prefix.includes('..') || (prefix.length > 0 && !/^[A-Za-z0-9/_-]+$/.test(prefix))) {
      throw new Error('Invalid data export storage prefix');
    }
    return prefix ? `${prefix}/${jobId}.csv` : `${jobId}.csv`;
  }

  private requireStorage(): FileStorageAdapter {
    if (!this.storage) {
      throw new Error('Data export artifact storage is not configured');
    }
    return this.storage;
  }

  async cleanupExpiredArtifacts(now = new Date()): Promise<{ expired: number; deleted: number }> {
    const expired = await this.repository.expireCompletedJobs(now);
    const artifacts = await this.repository.listExpiredArtifacts();
    let deleted = 0;
    for (const job of artifacts) {
      if (!job.artifact_storage_key) continue;
      try {
        await this.requireStorage().delete(job.artifact_storage_key);
        if (await this.repository.clearExpiredArtifact(job.id, job.artifact_storage_key)) {
          deleted += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Data export artifact cleanup failed for job ${job.id}: ${this.errorMessage(error)}`,
        );
      }
    }
    if (expired.length > 0 || deleted > 0) {
      this.logger.log(`Expired ${expired.length} export job(s); deleted ${deleted} artifact(s).`);
    }
    return { expired: expired.length, deleted };
  }

  @Cron(EXPORT_EXPIRY_CRON, {
    name: 'data_export_artifact_expiry',
    timeZone: 'Asia/Bangkok',
  })
  async runExpiryCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredArtifacts();
    } catch (error) {
      this.logger.warn(`Data export expiry cleanup failed: ${this.errorMessage(error)}`);
    }
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
