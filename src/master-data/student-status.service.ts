import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  CreateStudentStatusDto,
  ListStudentStatusesQueryDto,
  UpdateStudentStatusDto,
} from './dto/student-status.dto';
import { StudentStatusRepository } from './student-status.repository';
import type { StudentStatusRow } from './student-status.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class StudentStatusService {
  constructor(
    private readonly repository: StudentStatusRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private toResponse(row: StudentStatusRow) {
    return {
      code: row.code,
      labelTh: row.label_th,
      category: row.category,
      badgeVariant: row.badge_variant,
      isActiveForLogin: row.is_active_for_login,
      isTerminal: row.is_terminal,
      requiresFollowup: row.requires_followup,
      isEnabled: row.is_enabled,
      sortOrder: row.sort_order,
      sourceSystem: row.source_system,
      usageCount: row.usage_count,
    };
  }

  async list(query: ListStudentStatusesQueryDto, options?: { includeTechnical?: boolean }) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.list({
      page,
      limit,
      searchTerm: query.searchTerm?.trim() || undefined,
      sortBy: query.sortBy ?? 'sortOrder',
      sortDirection: query.sortDirection ?? 'asc',
      includeTechnical: options?.includeTechnical === true,
      includeInactive: query.includeInactive !== false,
    });
    return {
      data: rows.map((row) => this.toResponse(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async getByCode(code: number) {
    const row = await this.repository.findByCode(code);
    if (!row) {
      throw new NotFoundException('ไม่พบสถานะนักเรียน');
    }
    return { data: this.toResponse(row) };
  }

  async create(actor: AuthenticatedRequestUser, dto: CreateStudentStatusDto) {
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (queryRunner) => {
        await this.repository.create(
          dto.code,
          {
            labelTh: dto.labelTh.trim(),
            category: dto.category,
            badgeVariant: dto.badgeVariant,
            isActiveForLogin: dto.isActiveForLogin,
            isTerminal: dto.isTerminal,
            requiresFollowup: dto.requiresFollowup,
            isEnabled: dto.isEnabled,
            sortOrder: dto.sortOrder,
            sourceSystem: dto.sourceSystem.trim(),
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'student_status',
            targetId: String(dto.code),
            metadata: {
              op: 'create',
              changedFields: Object.keys(dto),
            },
            ip: null,
          },
          queryRunner,
        );
        const created = await this.repository.findByCode(dto.code, queryRunner);
        return { data: this.toResponse(created!) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รหัสสถานะนักเรียนนี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedRequestUser, code: number, dto: UpdateStudentStatusDto) {
    const actorId = resolveAuditActorId(actor);
    return await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findByCode(code, queryRunner);
      if (!existing) {
        throw new NotFoundException('ไม่พบสถานะนักเรียน');
      }

      await this.repository.update(
        code,
        {
          labelTh: dto.labelTh?.trim() ?? existing.label_th,
          category: dto.category ?? existing.category,
          badgeVariant: dto.badgeVariant ?? existing.badge_variant,
          isActiveForLogin: dto.isActiveForLogin ?? existing.is_active_for_login,
          isTerminal: dto.isTerminal ?? existing.is_terminal,
          requiresFollowup: dto.requiresFollowup ?? existing.requires_followup,
          isEnabled: dto.isEnabled ?? existing.is_enabled,
          sortOrder: dto.sortOrder ?? existing.sort_order,
          sourceSystem: dto.sourceSystem?.trim() ?? existing.source_system,
          actorId,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'student_status',
          targetId: String(code),
          metadata: {
            op: 'update',
            changedFields: Object.keys(dto),
          },
          ip: null,
        },
        queryRunner,
      );
      const updated = await this.repository.findByCode(code, queryRunner);
      return { data: this.toResponse(updated!) };
    });
  }

  async disable(actor: AuthenticatedRequestUser, code: number) {
    return await this.update(actor, code, { isEnabled: false });
  }
}
