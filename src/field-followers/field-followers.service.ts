import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clean } from '../common/utils/helpers';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedRequestUser } from '../auth';
import {
  type CreateFollowerApplicationDto,
  type FieldFollowerReviewAction,
  type FieldFollowerStatus,
  type ListFieldFollowersQueryDto,
} from './dto/field-followers.dto';
import { FieldFollowersRepository } from './field-followers.repository';
import type { FieldFollowerRow } from './field-followers.types';

const REVIEW_TRANSITIONS: Record<
  FieldFollowerReviewAction,
  {
    from: FieldFollowerStatus[];
    to: FieldFollowerStatus;
  }
> = {
  APPROVE: { from: ['APPLIED'], to: 'ACTIVE' },
  REJECT: { from: ['APPLIED'], to: 'SUSPENDED' },
  SUSPEND: { from: ['VERIFIED', 'ACTIVE'], to: 'SUSPENDED' },
  REACTIVATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
};

function resolveAuditActorId(actor?: AuthenticatedRequestUser): number | null {
  return actor?.id ?? null;
}

@Injectable()
export class FieldFollowersService {
  constructor(
    private readonly repository: FieldFollowersRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async createApplication(
    dto: CreateFollowerApplicationDto,
    meta: { ip: string | null },
  ): Promise<{ success: true }> {
    // Honeypot: bots that fill every field trip this hidden one. Return the
    // same success shape without inserting or auditing, so the bot gets no
    // signal that it was caught.
    if (dto.website && dto.website.trim().length > 0) {
      return { success: true };
    }

    const firstName = clean(dto.first_name);
    const lastName = clean(dto.last_name);
    const phone = clean(dto.phone);
    if (!firstName || !lastName || !phone) {
      throw new BadRequestException('first_name, last_name และ phone ต้องไม่ว่าง');
    }

    const row = await this.repository.createApplication({
      firstName,
      lastName,
      phone,
      subDistrict: clean(dto.sub_district),
      district: clean(dto.district),
      province: clean(dto.province),
    });

    await this.auditLog.record({
      action: 'FIELD_FOLLOWER_APPLY',
      actorUserId: null,
      actorLabel: 'public',
      targetType: 'field_follower',
      targetId: row.id,
      metadata: {
        province: row.province,
        district: row.district,
        subDistrict: row.sub_district,
      },
      ip: meta.ip,
    });

    return { success: true };
  }

  async listFollowers(actor: AuthenticatedRequestUser, query: ListFieldFollowersQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const { rows, totalCount } = await this.repository.listFollowers(actor.data_scope ?? {}, {
      status: query.status,
      province: query.province,
      district: query.district,
      subDistrict: query.subDistrict,
      page,
      limit,
    });

    return {
      success: true,
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        page,
        limit,
        totalCount,
        totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
      },
    };
  }

  async reviewFollower(
    id: string,
    action: FieldFollowerReviewAction,
    actor: AuthenticatedRequestUser,
    meta: { ip: string | null },
  ) {
    const existing = await this.repository.findByIdInScope(id, actor.data_scope ?? {});
    if (!existing) {
      throw new NotFoundException('ไม่พบผู้สมัคร');
    }

    const transition = REVIEW_TRANSITIONS[action];
    if (!transition.from.includes(existing.status)) {
      throw new ForbiddenException(`ไม่สามารถ ${action} จากสถานะปัจจุบัน (${existing.status}) ได้`);
    }

    const actorId = resolveAuditActorId(actor);
    if (actorId == null) {
      throw new ForbiddenException('ไม่พบตัวตนผู้ดำเนินการ');
    }

    const updated = await this.repository.updateStatus(id, transition.to, actorId);
    if (!updated) {
      throw new NotFoundException('ไม่พบผู้สมัคร');
    }

    await this.auditLog.record({
      action: 'FIELD_FOLLOWER_REVIEW',
      actorUserId: actorId,
      actorLabel: actor.username,
      targetType: 'field_follower',
      targetId: id,
      metadata: {
        reviewAction: action,
        fromStatus: existing.status,
        toStatus: transition.to,
      },
      ip: meta.ip,
    });

    return { success: true, data: this.toResponse(updated) };
  }

  private toResponse(row: FieldFollowerRow) {
    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      sub_district: row.sub_district,
      district: row.district,
      province: row.province,
      status: row.status,
      trust_level: row.trust_level,
      applied_via: row.applied_via,
      reviewed_by_user_id: row.reviewed_by_user_id,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
