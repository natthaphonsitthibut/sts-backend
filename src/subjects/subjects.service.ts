import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type { CreateSubjectDto, ListSubjectsQueryDto, UpdateSubjectDto } from './dto/subjects.dto';
import { SubjectsRepository } from './subjects.repository';
import type { SubjectRow } from './subjects.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class SubjectsService {
  constructor(
    private readonly repository: SubjectsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private toResponse(row: SubjectRow) {
    return {
      id: row.id,
      code: row.code,
      name_th: row.name_th,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async list(query: ListSubjectsQueryDto) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.list({
      page,
      limit,
      searchTerm: query.searchTerm?.trim() || undefined,
      isActive: query.isActive,
    });
    return {
      success: true,
      data: rows.map((row) => this.toResponse(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async create(actor: AuthenticatedRequestUser, dto: CreateSubjectDto) {
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (queryRunner) => {
        const created = await this.repository.create(dto.code, dto.nameTh, actorId, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'SUBJECT_CREATE',
            targetType: 'subject',
            targetId: String(created.id),
            metadata: { code: created.code },
            ip: null,
          },
          queryRunner,
        );
        return { success: true, data: this.toResponse(created) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รหัสวิชานี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedRequestUser, id: number, dto: UpdateSubjectDto) {
    const actorId = resolveAuditActorId(actor);
    return await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findById(id);
      if (!existing) {
        throw new NotFoundException('ไม่พบรายวิชา');
      }
      const updated = await this.repository.update(
        id,
        { nameTh: dto.nameTh?.trim(), isActive: dto.isActive },
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'SUBJECT_UPDATE',
          targetType: 'subject',
          targetId: String(id),
          metadata: { code: existing.code, changedFields: Object.keys(dto) },
          ip: null,
        },
        queryRunner,
      );
      return { success: true, data: this.toResponse(updated!) };
    });
  }
}
