import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import type { AuthenticatedRequestUser, DataScope } from '../auth';
import { TaskPolicyService } from '../task/task-policy.service';
import { PII_REASON_CODES } from './pii-fields.config';
import { PiiExportRepository } from './pii-export.repository';
import type { CreatePiiExportRequestDto } from './dto/pii-export.dto';
import type { PiiExportRequestRow, PiiExportStudentRow } from './pii-export.types';

const EXPORT_DOWNLOAD_TTL_HOURS = 24;
const EXPORT_EXPIRY_CRON = '0 5 4 * * *';
const EXPORT_REASON_CODES = PII_REASON_CODES.filter((code) => code !== 'SELF_ACCESS');

export interface PiiExportRequestMeta {
  ip: string | null;
}

function normalizeScalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return '';
}

function csvCell(value: unknown): string {
  const text = normalizeScalar(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function maskIdentifier(value: unknown): string {
  const normalized = normalizeScalar(value).replace(/[^0-9]/g, '');
  return normalized.length >= 4 ? `••••${normalized.slice(-4)}` : '-';
}

function maskDocument(value: unknown): string {
  const normalized = normalizeScalar(value);
  return normalized.length >= 4 ? `••••${normalized.slice(-4)}` : '-';
}

@Injectable()
export class PiiExportService {
  private readonly logger = new Logger(PiiExportService.name);

  constructor(
    private readonly repository: PiiExportRepository,
    private readonly taskPolicyService: TaskPolicyService,
  ) {}

  private normalizeScope(value: unknown): DataScope {
    const normalized = this.taskPolicyService.normalizeScope(value);
    const scope: DataScope = {};
    if (normalized.global) scope.global = true;
    if (normalized.provinces.length > 0) scope.provinces = normalized.provinces;
    if (normalized.districts.length > 0) scope.districts = normalized.districts;
    if (normalized.sub_districts.length > 0) scope.sub_districts = normalized.sub_districts;
    if (normalized.school_ids.length > 0) scope.school_ids = normalized.school_ids;
    if (normalized.grade_levels.length > 0) scope.grade_levels = normalized.grade_levels;
    if (normalized.room_ids.length > 0) scope.room_ids = normalized.room_ids;
    return scope;
  }

  private hasConcreteScope(scope: DataScope): boolean {
    return (
      scope.global === true ||
      Boolean(scope.provinces?.length) ||
      Boolean(scope.districts?.length) ||
      Boolean(scope.sub_districts?.length) ||
      Boolean(scope.school_ids?.length) ||
      Boolean(scope.grade_levels?.length) ||
      Boolean(scope.room_ids?.length)
    );
  }

  private assertScopeAllowed(scope: DataScope, actor: AuthenticatedRequestUser): void {
    if (!this.hasConcreteScope(scope)) {
      throw new BadRequestException('scope is required');
    }
    if (!this.taskPolicyService.isScopeSubsetOfActor(scope, actor.data_scope)) {
      throw new ForbiddenException('ไม่สามารถขอส่งออกข้อมูลนอกขอบเขตสิทธิ์ของตนเองได้');
    }
  }

  private async assertApprover(actor: AuthenticatedRequestUser, request: PiiExportRequestRow) {
    const roleMap = await this.taskPolicyService.getRoleMap();
    const role = this.taskPolicyService.getPrimaryRole(actor);
    if (role !== 'ADMIN' || this.taskPolicyService.getRoleRank(role, roleMap) < 5) {
      throw new ForbiddenException('ต้องเป็นผู้ดูแลระบบระดับ 5 เพื่ออนุมัติคำขอส่งออก');
    }
    if (actor.id === request.requester_user_id) {
      throw new ForbiddenException('ไม่สามารถอนุมัติคำขอของตนเองได้');
    }
    if (!this.taskPolicyService.isScopeSubsetOfActor(request.scope_snapshot, actor.data_scope)) {
      throw new ForbiddenException('ไม่สามารถอนุมัติคำขอนอกขอบเขตสิทธิ์ของตนเองได้');
    }
  }

  private assertReason(reasonCode: string, reasonNote: string | undefined): string {
    if (!EXPORT_REASON_CODES.includes(reasonCode as (typeof EXPORT_REASON_CODES)[number])) {
      throw new BadRequestException('reason_code is invalid');
    }
    const note = clean(reasonNote ?? '') || '';
    if (!note) {
      throw new BadRequestException('reason_note is required');
    }
    if (/\d(?:[\s-]*\d){9,}/u.test(note)) {
      throw new BadRequestException('reason_note must not contain ID or document numbers');
    }
    return note;
  }

  private toResponse(row: PiiExportRequestRow, includeToken?: string) {
    return {
      id: row.id,
      requester_user_id: row.requester_user_id,
      requester_username: row.requester_username ?? null,
      requester_name: row.requester_name ?? null,
      approver_user_id: row.approver_user_id ?? null,
      approver_username: row.approver_username ?? null,
      approver_name: row.approver_name ?? null,
      status: row.status,
      scope_snapshot: row.scope_snapshot,
      include_full_national_id: row.include_full_national_id,
      reason_code: row.reason_code,
      reason_note: row.reason_note,
      row_estimate: row.row_estimate,
      download_expires_at: row.download_expires_at,
      downloaded_at: row.downloaded_at,
      rejected_reason: row.rejected_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(includeToken ? { download_token: includeToken } : {}),
    };
  }

  async createRequest(
    actor: AuthenticatedRequestUser,
    dto: CreatePiiExportRequestDto,
    meta: PiiExportRequestMeta,
  ) {
    const scope = this.normalizeScope(dto.scope);
    this.assertScopeAllowed(scope, actor);
    const reasonNote = this.assertReason(dto.reason_code, dto.reason_note);
    const rowEstimate = await this.repository.countStudentsForScope(scope);
    const row = await this.repository.withTransaction(async (executor) => {
      const request = await this.repository.createRequest(
        {
          requesterUserId: actor.id,
          scopeSnapshot: scope,
          includeFullNationalId: dto.include_full_national_id === true,
          reasonCode: dto.reason_code,
          reasonNote,
          rowEstimate,
        },
        executor,
      );
      await this.repository.insertEvent(
        {
          requestId: request.id,
          actorUserId: actor.id,
          action: 'REQUEST',
          metadata: {
            includeFullNationalId: dto.include_full_national_id === true,
            rowEstimate,
            reasonCode: dto.reason_code,
          },
          ip: meta.ip,
        },
        executor,
      );
      return request;
    });
    return { success: true, data: this.toResponse(row) };
  }

  async listRequests(
    actor: AuthenticatedRequestUser,
    query: { status?: string; page?: number; limit?: number },
  ) {
    const roleMap = await this.taskPolicyService.getRoleMap();
    const role = this.taskPolicyService.getPrimaryRole(actor);
    const isApprover = role === 'ADMIN' && this.taskPolicyService.getRoleRank(role, roleMap) >= 5;
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const { rows, totalCount } = await this.repository.listRequests({
      actorUserId: actor.id,
      actorScope: actor.data_scope ?? {},
      isApprover,
      status: query.status,
      page,
      limit,
    });
    const scopedRows = isApprover
      ? rows.filter(
          (row) =>
            row.requester_user_id === actor.id ||
            this.taskPolicyService.isScopeSubsetOfActor(row.scope_snapshot, actor.data_scope),
        )
      : rows;
    return {
      success: true,
      data: scopedRows.map((row) => this.toResponse(row)),
      meta: {
        page,
        limit,
        totalCount: scopedRows.length === rows.length ? totalCount : scopedRows.length,
        totalPages:
          limit > 0
            ? Math.ceil(
                (scopedRows.length === rows.length ? totalCount : scopedRows.length) / limit,
              )
            : 0,
      },
    };
  }

  async approveRequest(id: string, actor: AuthenticatedRequestUser, meta: PiiExportRequestMeta) {
    const request = await this.repository.findRequestById(id);
    if (!request) {
      throw new NotFoundException('ไม่พบคำขอส่งออกข้อมูล');
    }
    await this.assertApprover(actor, request);
    if (request.status !== 'PENDING') {
      throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + EXPORT_DOWNLOAD_TTL_HOURS * 60 * 60 * 1000);
    const approved = await this.repository.withTransaction(async (executor) => {
      const updated = await this.repository.approveRequest(
        {
          id,
          approverUserId: actor.id,
          downloadTokenHash: hashToken(token),
          expiresAt,
        },
        executor,
      );
      if (!updated) {
        throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
      }
      await this.repository.insertEvent(
        {
          requestId: id,
          actorUserId: actor.id,
          action: 'APPROVE',
          metadata: {
            includeFullNationalId: request.include_full_national_id,
            expiresAt: expiresAt.toISOString(),
          },
          ip: meta.ip,
        },
        executor,
      );
      return { ...request, ...updated, approver_user_id: actor.id, download_expires_at: expiresAt };
    });
    return { success: true, data: this.toResponse(approved, token) };
  }

  async rejectRequest(
    id: string,
    actor: AuthenticatedRequestUser,
    reason: string,
    meta: PiiExportRequestMeta,
  ) {
    const request = await this.repository.findRequestById(id);
    if (!request) {
      throw new NotFoundException('ไม่พบคำขอส่งออกข้อมูล');
    }
    await this.assertApprover(actor, request);
    if (request.status !== 'PENDING') {
      throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
    }
    const rejectedReason = clean(reason) || '';
    if (!rejectedReason) {
      throw new BadRequestException('rejected_reason is required');
    }
    const rejected = await this.repository.withTransaction(async (executor) => {
      const updated = await this.repository.rejectRequest(
        { id, approverUserId: actor.id, reason: rejectedReason },
        executor,
      );
      if (!updated) {
        throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
      }
      await this.repository.insertEvent(
        {
          requestId: id,
          actorUserId: actor.id,
          action: 'REJECT',
          metadata: { reasonLength: rejectedReason.length },
          ip: meta.ip,
        },
        executor,
      );
      return {
        ...request,
        ...updated,
        approver_user_id: actor.id,
        rejected_reason: rejectedReason,
      };
    });
    return { success: true, data: this.toResponse(rejected) };
  }

  private exportRowsToCsv(request: PiiExportRequestRow, rows: PiiExportStudentRow[]): string {
    const nationalIdHeader = request.include_full_national_id
      ? 'เลขบัตรประชาชน'
      : 'เลขบัตรประชาชน (ปิดบัง)';
    const csvRows = [
      ['export_id', request.id],
      ['requester', request.requester_username ?? request.requester_user_id],
      ['approver', request.approver_username ?? request.approver_user_id ?? '-'],
      ['generated_at', new Date().toISOString()],
      ['purpose', request.reason_code],
      [],
      [
        'ชื่อ',
        'นามสกุล',
        nationalIdHeader,
        'พาสปอร์ต (ปิดบัง)',
        'รหัสโรงเรียน',
        'โรงเรียน',
        'ชั้น',
        'ห้อง',
        'สถานะนักเรียน',
        'หมู่',
        'ตรอก',
        'ซอย',
        'ถนน',
        'ตำบล/แขวง',
        'อำเภอ/เขต',
        'จังหวัด',
        'รหัสไปรษณีย์',
      ],
      ...rows.map((row) => [
        row.FirstName_Onec,
        row.LastName_Onec,
        request.include_full_national_id ? row.PersonID_Onec : maskIdentifier(row.PersonID_Onec),
        maskDocument(row.PassportNumber_Onec),
        row.SchoolID_Onec,
        row.school_name,
        row.grade,
        row.RoomID_Onec,
        row.student_status_label,
        row.VillageNumber_Onec,
        row.Trok_Onec,
        row.Soi_Onec,
        row.Street_Onec,
        row.SubDistrictNameThai_Onec,
        row.DistrictNameThai_Onec,
        row.ProvinceNameThai_Onec,
        row.PostalCode_Onec,
      ]),
    ];
    return `\uFEFF${csvRows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
  }

  async download(
    token: string,
    meta: PiiExportRequestMeta,
  ): Promise<{ filename: string; csv: string }> {
    const tokenHash = hashToken(token);
    const request = await this.repository.withTransaction(async (executor) => {
      const claimed = await this.repository.claimDownload(tokenHash, executor);
      if (!claimed) {
        return null;
      }
      await this.repository.insertEvent(
        {
          requestId: claimed.id,
          actorUserId: null,
          action: 'DOWNLOAD',
          metadata: { includeFullNationalId: claimed.include_full_national_id },
          ip: meta.ip,
        },
        executor,
      );
      return claimed;
    });
    if (!request) {
      const existing = await this.repository.findRequestByTokenHash(tokenHash);
      if (!existing) {
        throw new NotFoundException('ไม่พบลิงก์ดาวน์โหลด');
      }
      throw new GoneException('ลิงก์ดาวน์โหลดหมดอายุหรือถูกใช้ไปแล้ว');
    }
    const rows = await this.repository.listStudentsForExport(request.scope_snapshot);
    const csv = this.exportRowsToCsv(request, rows);
    return {
      filename: `pii-export-${request.id.slice(0, 8)}.csv`,
      csv,
    };
  }

  async expireApprovedRequests(now = new Date()): Promise<{ expired: number }> {
    const expired = await this.repository.withTransaction(async (executor) => {
      const rows = await this.repository.claimExpiredRequests(now, executor);
      for (const row of rows) {
        await this.repository.insertEvent(
          {
            requestId: row.id,
            actorUserId: null,
            action: 'EXPIRE',
            metadata: { expiredAt: now.toISOString() },
          },
          executor,
        );
      }
      return rows.length;
    });
    if (expired > 0) {
      this.logger.log(`Expired ${expired} PII export request(s).`);
    }
    return { expired };
  }

  @Cron(EXPORT_EXPIRY_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'pii_export_expiry',
  })
  async runExpiryCron(): Promise<void> {
    try {
      await this.expireApprovedRequests();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`PII export expiry job failed: ${message}`);
    }
  }
}
