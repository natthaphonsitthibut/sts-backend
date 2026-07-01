import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PasswordService } from '../auth/password.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import {
  STUDENT_ACCOUNT_PERMISSIONS,
  STUDENT_ACCOUNT_ROLE,
  TEMP_PASSWORD_TTL_DAYS,
  USERNAME_ALPHABET,
} from './users.service';
import {
  StudentAccountBatchRepository,
  type BatchJobItemInput,
  type BatchJobRow,
} from './student-account-batch.repository';
import type { GenerateStudentAccountsDto, StudentAccountBatchListQueryDto } from './dto/users.dto';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  StudentAccountCandidateRow,
} from './users.types';

const CHUNK_SIZE = 100;
const CREDENTIAL_PAGE_LIMIT = 200;

interface BatchScopeSnapshot {
  actorScope: DataScope;
  schoolId: number | null;
  province: string | null;
  district: string | null;
  subDistrict: string | null;
  grade: string | null;
  room: number | null;
}

/**
 * Async large-batch student-account generation. The HTTP request only enqueues
 * a durable job and returns immediately; processing runs in-process in fixed
 * chunks that commit as they go, so progress survives failures and the job is
 * resumable. Idempotent by construction: created accounts leave the candidate
 * set and every processed candidate keeps a job-item row, so a re-run continues
 * where it stopped and always terminates. Credentials are never stored — a
 * printable sheet is produced on demand by rotating temporary passwords through
 * the existing reissue path.
 *
 * NOTE: the concurrency guard is in-process only. A durable queue / advisory
 * locks for multi-instance safety is deferred to the Redis/queue phase.
 */
@Injectable()
export class StudentAccountBatchService implements OnModuleInit {
  private readonly logger = new Logger(StudentAccountBatchService.name);
  private readonly runningJobs = new Set<string>();

  constructor(
    private readonly batchRepository: StudentAccountBatchRepository,
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const interrupted = await this.batchRepository.markRunningJobsInterrupted();
      if (interrupted > 0) {
        this.logger.warn(
          `Marked ${interrupted} student-account batch job(s) as INTERRUPTED on startup; use resume to continue.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to recover interrupted student-account batch jobs: ${this.errorMessage(error)}`,
      );
    }
  }

  async enqueue(actor: ActorContext | undefined, filters: GenerateStudentAccountsDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const scope = this.buildScopeSnapshot(currentActor, filters);
    const summary = await this.usersRepository.countStudentAccountCandidates({
      actorScope: scope.actorScope,
      schoolId: scope.schoolId ?? undefined,
      province: scope.province ?? undefined,
      district: scope.district ?? undefined,
      subDistrict: scope.subDistrict ?? undefined,
      grade: scope.grade ?? undefined,
      room: scope.room ?? undefined,
      onlyWithoutAccount: false,
    });
    const job = await this.batchRepository.createJob({
      id: randomUUID(),
      createdBy: resolveAuditActorId(currentActor),
      scopeSnapshot: scope as unknown as Record<string, unknown>,
      totalCandidates: summary.withoutAccountCount,
    });
    await this.auditLog.record({
      action: 'STUDENT_ACCOUNT_BATCH_ENQUEUE',
      actorUserId: resolveAuditActorId(currentActor),
      actorLabel: currentActor.username,
      targetType: 'student_account_batch_job',
      targetId: job.id,
      metadata: {
        totalCandidates: job.total_candidates,
        scopeLabel:
          !scope.province && !scope.district && !scope.subDistrict && !scope.schoolId
            ? 'ทุกโรงเรียน'
            : null,
        province: scope.province,
        district: scope.district,
        subDistrict: scope.subDistrict,
        schoolId: scope.schoolId,
        grade: scope.grade,
        room: scope.room,
      },
    });
    void this.runJob(job.id).catch((error) => {
      this.logger.error(`Batch job ${job.id} crashed: ${this.errorMessage(error)}`);
    });
    return { success: true, data: this.toJobResponse(job) };
  }

  async listJobs(actor: ActorContext | undefined, query: StudentAccountBatchListQueryDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const { rows, totalCount } = await this.batchRepository.listJobs({
      createdBy: resolveAuditActorId(currentActor),
      status: query.status,
      onlyOwn: !this.canSeeAllJobs(currentActor),
      page,
      limit,
    });
    return {
      success: true,
      data: rows.map((row) => this.toJobResponse(row)),
      meta: { page, limit, total: totalCount },
    };
  }

  async getJob(actor: ActorContext | undefined, jobId: string) {
    const { job } = await this.requireVisibleJob(actor, jobId);
    return { success: true, data: this.toJobResponse(job) };
  }

  async resume(actor: ActorContext | undefined, jobId: string) {
    const { job, actorId } = await this.requireVisibleJob(actor, jobId);
    if (!['INTERRUPTED', 'FAILED'].includes(job.status)) {
      throw new ForbiddenException('งานนี้ไม่อยู่ในสถานะที่ทำต่อได้');
    }
    void this.runJob(jobId).catch((error) => {
      this.logger.error(`Batch job ${jobId} crashed on resume: ${this.errorMessage(error)}`);
    });
    await this.auditLog.record({
      action: 'STUDENT_ACCOUNT_BATCH_RESUME',
      actorUserId: actorId,
      actorLabel: actor?.username,
      targetType: 'student_account_batch_job',
      targetId: jobId,
      metadata: { previousStatus: job.status },
    });
    const refreshed = (await this.batchRepository.findJobById(jobId)) ?? job;
    return { success: true, data: this.toJobResponse(refreshed) };
  }

  async cancel(actor: ActorContext | undefined, jobId: string) {
    const { job, actorId } = await this.requireVisibleJob(actor, jobId);
    const canceled = await this.batchRepository.requestCancel(jobId);
    if (!canceled) {
      throw new ForbiddenException('งานนี้เสร็จสิ้นแล้ว ยกเลิกไม่ได้');
    }
    await this.auditLog.record({
      action: 'STUDENT_ACCOUNT_BATCH_CANCEL',
      actorUserId: actorId,
      actorLabel: actor?.username,
      targetType: 'student_account_batch_job',
      targetId: jobId,
      metadata: { previousStatus: job.status },
    });
    return { success: true, data: this.toJobResponse(canceled) };
  }

  /**
   * Produce a one-time printable credential sheet for the accounts this job
   * created, by rotating their temporary passwords (reuses the audited reissue
   * path). Re-downloading rotates again and invalidates any previously printed
   * sheet. Paginated because rotation touches every account.
   */
  async downloadCredentials(
    actor: ActorContext | undefined,
    jobId: string,
    query: { page?: number; limit?: number },
  ) {
    const { job, actorId } = await this.requireVisibleJob(actor, jobId);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(
      Math.max(query.limit ?? CREDENTIAL_PAGE_LIMIT, 1),
      CREDENTIAL_PAGE_LIMIT,
    );
    const { rows, totalCount } = await this.batchRepository.listCreatedAccounts(jobId, page, limit);

    const credentials: Array<Record<string, unknown>> = [];
    const skipped: Array<{ userId: number; reason: string }> = [];
    for (const row of rows) {
      const tempPassword = this.passwordService.generateTempPassword();
      const passwordHash = await this.passwordService.hash(tempPassword);
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
      const updated = await this.usersRepository.reissueTemporaryPassword(
        row.user_id,
        passwordHash,
        issuedAt,
        expiresAt,
      );
      if (!updated) {
        skipped.push({ userId: row.user_id, reason: 'บัญชีถูกปิดการใช้งาน' });
        continue;
      }
      const detail = row.detail ?? {};
      credentials.push({
        userId: row.user_id,
        username: row.username,
        tempPassword,
        studentName: detail.studentName ?? null,
        schoolName: detail.schoolName ?? null,
        grade: detail.grade ?? null,
        room: detail.room ?? null,
        temporaryPasswordIssuedAt: issuedAt.toISOString(),
        temporaryPasswordExpiresAt: expiresAt.toISOString(),
      });
    }

    const auditResults = await Promise.allSettled(
      credentials.map((credential) =>
        this.auditLog.record({
          action: 'STUDENT_TEMP_PASSWORD_REISSUE',
          actorUserId: actorId,
          actorLabel: actor?.username,
          targetType: 'user',
          targetId: String(credential.userId),
          metadata: {
            op: 'batch-credentials',
            jobId,
            expiresAt: credential.temporaryPasswordExpiresAt,
          },
        }),
      ),
    );
    for (const result of auditResults) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Audit write failed for batch credential rotation: ${this.errorMessage(result.reason)}`,
        );
      }
    }

    return {
      success: true,
      jobId: job.id,
      meta: { page, limit, total: totalCount },
      reissuedCount: credentials.length,
      skippedCount: skipped.length,
      credentials,
      skipped,
    };
  }

  // --- processing engine -------------------------------------------------

  private async runJob(jobId: string): Promise<void> {
    if (this.runningJobs.has(jobId)) {
      return;
    }
    this.runningJobs.add(jobId);
    try {
      const claimed = await this.batchRepository.claimJobForRun(jobId);
      if (!claimed) {
        return;
      }
      const scope = this.readScopeSnapshot(claimed);
      for (;;) {
        const current = await this.batchRepository.findJobById(jobId);
        if (!current || current.status === 'CANCELED') {
          return;
        }
        const candidates = await this.usersRepository.listStudentAccountCandidates({
          actorScope: scope.actorScope,
          schoolId: scope.schoolId ?? undefined,
          province: scope.province ?? undefined,
          district: scope.district ?? undefined,
          subDistrict: scope.subDistrict ?? undefined,
          grade: scope.grade ?? undefined,
          room: scope.room ?? undefined,
          onlyWithoutAccount: true,
          excludeProcessedForJobId: jobId,
          page: 1,
          limit: CHUNK_SIZE,
        });
        if (candidates.length === 0) {
          break;
        }
        await this.processChunk(jobId, claimed.created_by, candidates);
        await this.batchRepository.syncJobCounters(jobId);
      }
      const finalJob = await this.batchRepository.findJobById(jobId);
      if (finalJob && finalJob.status === 'RUNNING') {
        await this.batchRepository.setJobStatus(jobId, 'COMPLETED', { finished: true });
      }
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`Batch job ${jobId} failed: ${message}`);
      await this.batchRepository
        .setJobStatus(jobId, 'FAILED', { errorSummary: message.slice(0, 1000), finished: true })
        .catch(() => undefined);
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  private async processChunk(
    jobId: string,
    createdBy: number | null,
    candidates: StudentAccountCandidateRow[],
  ): Promise<void> {
    for (const candidate of candidates) {
      try {
        // Create the account and its CREATED item in one transaction; on any
        // failure the whole transaction rolls back and we record the outcome in
        // a fresh transaction (a poisoned tx cannot accept further statements).
        await this.batchRepository.withTransaction((executor) =>
          this.createAccount(jobId, createdBy, candidate, executor),
        );
      } catch (error) {
        const isDuplicate = this.isUniqueViolation(error);
        await this.batchRepository.insertItems([
          {
            jobId,
            personUuid: candidate.person_uuid,
            userId: null,
            username: null,
            detail: this.candidateDetail(candidate),
            status: isDuplicate ? 'SKIPPED' : 'FAILED',
            errorCode: isDuplicate ? 'DUPLICATE' : this.errorCode(error),
          },
        ]);
        if (!isDuplicate) {
          this.logger.warn(
            `Batch job ${jobId} failed to create account for person ${candidate.person_uuid}: ${this.errorMessage(error)}`,
          );
        }
      }
    }
  }

  private async createAccount(
    jobId: string,
    createdBy: number | null,
    candidate: StudentAccountCandidateRow,
    executor: QueryExecutor,
  ): Promise<void> {
    const username = await this.generateUniqueStudentUsername(candidate.school_id, executor);
    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000);
    const userId = await this.usersRepository.createUser(
      {
        username,
        passwordHash,
        firstName: candidate.first_name || '-',
        lastName: candidate.last_name || '-',
        personIdOnec: '',
        personUuid: candidate.person_uuid,
        phone: null,
        email: null,
        affiliation: candidate.school_name || null,
        status: 'ACTIVE',
        permissions: [...STUDENT_ACCOUNT_PERMISSIONS],
        role: STUDENT_ACCOUNT_ROLE,
        dataScope: { own_only: true },
        mustChangePassword: true,
        temporaryPasswordIssuedAt: issuedAt,
        temporaryPasswordExpiresAt: expiresAt,
        createdBy,
      },
      executor,
    );
    const item: BatchJobItemInput = {
      jobId,
      personUuid: candidate.person_uuid,
      userId,
      username,
      detail: this.candidateDetail(candidate),
      status: 'CREATED',
      errorCode: null,
    };
    await this.batchRepository.insertItems([item], executor);
  }

  private candidateDetail(candidate: StudentAccountCandidateRow): Record<string, unknown> {
    return {
      studentName: [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || '-',
      schoolName: candidate.school_name,
      grade: candidate.grade_label,
      room: candidate.room_id,
    };
  }

  private async generateUniqueStudentUsername(
    schoolId: number,
    executor: QueryExecutor,
  ): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = Array.from(
        { length: 5 },
        () => USERNAME_ALPHABET[randomInt(0, USERNAME_ALPHABET.length)],
      ).join('');
      const username = `${schoolId}-${suffix}`;
      if (!(await this.usersRepository.usernameExists(username, executor))) {
        return username;
      }
    }
    throw new Error('ไม่สามารถสุ่ม username ที่ไม่ซ้ำได้');
  }

  // --- helpers -----------------------------------------------------------

  private assertCanManageStudentAccounts(actor: ActorContext): void {
    const permissions = new Set(actor.permissions || []);
    if (
      permissions.has('manage-student-accounts') ||
      permissions.has('*') ||
      permissions.has('ALL')
    ) {
      return;
    }
    throw new ForbiddenException('ไม่มีสิทธิ์สร้างบัญชีนักเรียน');
  }

  private canSeeAllJobs(actor: ActorContext): boolean {
    const permissions = new Set(actor.permissions || []);
    return permissions.has('*') || permissions.has('ALL');
  }

  private async requireVisibleJob(
    actor: ActorContext | undefined,
    jobId: string,
  ): Promise<{ job: BatchJobRow; actorId: number | null }> {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    this.assertCanManageStudentAccounts(currentActor);
    const job = await this.batchRepository.findJobById(jobId);
    const actorId = resolveAuditActorId(currentActor);
    if (!job || (!this.canSeeAllJobs(currentActor) && job.created_by !== actorId)) {
      throw new NotFoundException('ไม่พบงานสร้างบัญชีนักเรียน');
    }
    return { job, actorId };
  }

  private buildScopeSnapshot(
    actor: ActorContext,
    filters: GenerateStudentAccountsDto,
  ): BatchScopeSnapshot {
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีส่วนตัวไม่สามารถสร้างบัญชีนักเรียนได้');
    }
    const cleanString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value.trim() : null;
    return {
      actorScope: actor.data_scope ?? {},
      schoolId: typeof filters.schoolId === 'number' ? filters.schoolId : null,
      province: cleanString(filters.province),
      district: cleanString(filters.district),
      subDistrict: cleanString(filters.subDistrict),
      grade: cleanString(filters.grade),
      room: typeof filters.room === 'number' ? filters.room : null,
    };
  }

  private readScopeSnapshot(job: BatchJobRow): BatchScopeSnapshot {
    const raw = (job.scope_snapshot ?? {}) as Partial<BatchScopeSnapshot>;
    return {
      actorScope: (raw.actorScope as DataScope) ?? {},
      schoolId: typeof raw.schoolId === 'number' ? raw.schoolId : null,
      province: raw.province ?? null,
      district: raw.district ?? null,
      subDistrict: raw.subDistrict ?? null,
      grade: raw.grade ?? null,
      room: typeof raw.room === 'number' ? raw.room : null,
    };
  }

  private toJobResponse(job: BatchJobRow) {
    const toIso = (value: string | Date | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    const scope = this.readScopeSnapshot(job);
    return {
      id: job.id,
      status: job.status,
      totalCandidates: job.total_candidates,
      processedCount: job.processed_count,
      createdCount: job.created_count,
      skippedCount: job.skipped_count,
      failedCount: job.failed_count,
      errorSummary: job.error_summary,
      scope: {
        schoolId: scope.schoolId,
        province: scope.province,
        district: scope.district,
        subDistrict: scope.subDistrict,
        grade: scope.grade,
        room: scope.room,
      },
      startedAt: toIso(job.started_at),
      finishedAt: toIso(job.finished_at),
      createdAt: toIso(job.created_at),
      updatedAt: toIso(job.updated_at),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return this.errorCode(error) === '23505';
  }

  private errorCode(error: unknown): string | null {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
