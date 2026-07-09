import * as crypto from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeDataScope, resolveActorDataScope, type AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { clean } from '../common/utils/helpers';
import { TaskPolicyService } from '../task/task-policy.service';
import type {
  CreateFollowerRecruitmentCampaignDto,
  UpdateFollowerRecruitmentCampaignDto,
} from './dto/follower-recruitment-campaign.dto';
import { FollowerRecruitmentCampaignRepository } from './follower-recruitment-campaign.repository';
import type { FollowerRecruitmentCampaignRow } from './follower-recruitment-campaign.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function parseWindowDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง');
  }
  return parsed;
}

const MAX_CODE_GENERATION_ATTEMPTS = 5;

@Injectable()
export class FollowerRecruitmentCampaignService {
  constructor(
    private readonly repository: FollowerRecruitmentCampaignRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(
    dto: CreateFollowerRecruitmentCampaignDto,
    actor: AuthenticatedRequestUser,
    meta: { ip: string | null },
  ) {
    const name = clean(dto.name);
    if (!name) {
      throw new BadRequestException('กรุณาระบุชื่อลิงก์รับสมัคร');
    }

    const opensAt = parseWindowDate(dto.opens_at);
    const closesAt = parseWindowDate(dto.closes_at);
    if (opensAt && closesAt && closesAt <= opensAt) {
      throw new BadRequestException('วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร');
    }

    const requestedScope = normalizeDataScope(dto.data_scope) ?? resolveActorDataScope(actor) ?? {};
    if (!this.taskPolicyService.isScopeSubsetOfActor(requestedScope, actor.data_scope)) {
      throw new ForbiddenException('ขอบเขตพื้นที่ที่เลือกเกินขอบเขตของผู้ใช้');
    }

    const actorId = resolveAuditActorId(actor);
    const row = await this.createWithUniqueCode({
      name,
      description: clean(dto.description),
      dataScope: requestedScope,
      opensAt: opensAt ?? null,
      closesAt: closesAt ?? null,
      createdBy: actorId,
    });

    await this.auditLog.record({
      action: 'FOLLOWER_CAMPAIGN_CREATE',
      actorUserId: actorId,
      actorLabel: actor.username,
      targetType: 'follower_recruitment_campaign',
      targetId: row.id,
      metadata: { name: row.name },
      ip: meta.ip,
    });

    return { success: true, data: this.toResponse(row) };
  }

  private async createWithUniqueCode(input: {
    name: string;
    description: string | null;
    dataScope: ReturnType<typeof normalizeDataScope>;
    opensAt: Date | null;
    closesAt: Date | null;
    createdBy: number | null;
  }): Promise<FollowerRecruitmentCampaignRow> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const publicCode = crypto.randomBytes(12).toString('base64url');
      try {
        return await this.repository.create({
          name: input.name,
          description: input.description,
          publicCode,
          dataScope: input.dataScope ?? {},
          opensAt: input.opensAt,
          closesAt: input.closesAt,
          createdBy: input.createdBy,
        });
      } catch (error) {
        if (isUniqueViolation(error) && attempt < MAX_CODE_GENERATION_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException('ไม่สามารถสร้างลิงก์รับสมัครได้ กรุณาลองใหม่');
  }

  async list(actor: AuthenticatedRequestUser) {
    const rows = await this.repository.listAll();
    const visible = rows.filter((row) =>
      this.taskPolicyService.isScopeSubsetOfActor(row.data_scope, actor.data_scope),
    );
    return {
      success: true,
      data: visible.map((row) => this.toResponse(row)),
      meta: { totalCount: visible.length },
    };
  }

  async update(
    id: string,
    dto: UpdateFollowerRecruitmentCampaignDto,
    actor: AuthenticatedRequestUser,
    meta: { ip: string | null },
  ) {
    const existing = await this.findAuthorized(id, actor);

    const nextScope =
      dto.data_scope !== undefined ? (normalizeDataScope(dto.data_scope) ?? {}) : undefined;
    if (
      nextScope !== undefined &&
      !this.taskPolicyService.isScopeSubsetOfActor(nextScope, actor.data_scope)
    ) {
      throw new ForbiddenException('ขอบเขตพื้นที่ที่เลือกเกินขอบเขตของผู้ใช้');
    }

    const opensAt = parseWindowDate(dto.opens_at);
    const closesAt = parseWindowDate(dto.closes_at);
    const effectiveOpensAt = opensAt ?? this.toDateOrNull(existing.opens_at) ?? undefined;
    const effectiveClosesAt = closesAt ?? this.toDateOrNull(existing.closes_at) ?? undefined;
    if (effectiveOpensAt && effectiveClosesAt && effectiveClosesAt <= effectiveOpensAt) {
      throw new BadRequestException('วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร');
    }

    const actorId = resolveAuditActorId(actor);
    const name = dto.name !== undefined ? clean(dto.name) : undefined;
    if (dto.name !== undefined && !name) {
      throw new BadRequestException('กรุณาระบุชื่อลิงก์รับสมัคร');
    }

    const updated = await this.repository.update(id, {
      name: name ?? undefined,
      description: dto.description !== undefined ? clean(dto.description) : undefined,
      dataScope: nextScope,
      opensAt,
      closesAt,
      isActive: dto.is_active,
      updatedBy: actorId,
    });
    if (!updated) {
      throw new NotFoundException('ไม่พบลิงก์รับสมัคร');
    }

    await this.auditLog.record({
      action: 'FOLLOWER_CAMPAIGN_UPDATE',
      actorUserId: actorId,
      actorLabel: actor.username,
      targetType: 'follower_recruitment_campaign',
      targetId: id,
      metadata: { fieldCount: Object.keys(dto).length },
      ip: meta.ip,
    });

    return { success: true, data: this.toResponse(updated) };
  }

  async remove(id: string, actor: AuthenticatedRequestUser, meta: { ip: string | null }) {
    const existing = await this.findAuthorized(id, actor);
    const actorId = resolveAuditActorId(actor);
    const deleted = await this.repository.softDelete(id, actorId);
    if (!deleted) {
      throw new NotFoundException('ไม่พบลิงก์รับสมัคร');
    }

    await this.auditLog.record({
      action: 'FOLLOWER_CAMPAIGN_DELETE',
      actorUserId: actorId,
      actorLabel: actor.username,
      targetType: 'follower_recruitment_campaign',
      targetId: id,
      metadata: { name: existing.name },
      ip: meta.ip,
    });

    return { success: true };
  }

  /** Public: minimal info for the apply-page gate, no internal fields leaked. */
  async getPublicCampaignInfo(code: string) {
    const row = await this.repository.findByPublicCode(code);
    if (!row) {
      throw new NotFoundException('ไม่พบลิงก์รับสมัครนี้');
    }
    await this.repository.incrementViewCount(row.id);
    return { name: row.name, is_open: this.isEffectivelyOpen(row) };
  }

  /** Internal: resolve+validate a campaign for a submission. Throws if closed/missing. */
  async resolveOpenCampaignByCode(code: string): Promise<FollowerRecruitmentCampaignRow> {
    const row = await this.repository.findByPublicCode(code);
    if (!row || !this.isEffectivelyOpen(row)) {
      throw new BadRequestException('ลิงก์รับสมัครนี้ปิดรับสมัครแล้วหรือไม่ถูกต้อง');
    }
    return row;
  }

  private async findAuthorized(
    id: string,
    actor: AuthenticatedRequestUser,
  ): Promise<FollowerRecruitmentCampaignRow> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('ไม่พบลิงก์รับสมัคร');
    }
    if (!this.taskPolicyService.isScopeSubsetOfActor(row.data_scope, actor.data_scope)) {
      throw new NotFoundException('ไม่พบลิงก์รับสมัคร');
    }
    return row;
  }

  private isEffectivelyOpen(row: FollowerRecruitmentCampaignRow): boolean {
    if (!row.is_active) return false;
    const now = new Date();
    const opensAt = this.toDateOrNull(row.opens_at);
    const closesAt = this.toDateOrNull(row.closes_at);
    if (opensAt && now < opensAt) return false;
    if (closesAt && now >= closesAt) return false;
    return true;
  }

  private toDateOrNull(value: Date | string | null): Date | null {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
  }

  private toResponse(row: FollowerRecruitmentCampaignRow) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      public_code: row.public_code,
      data_scope: row.data_scope,
      is_active: row.is_active,
      is_open: this.isEffectivelyOpen(row),
      opens_at: row.opens_at,
      closes_at: row.closes_at,
      view_count: Number(row.view_count) || 0,
      submission_count: Number(row.submission_count ?? 0) || 0,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
