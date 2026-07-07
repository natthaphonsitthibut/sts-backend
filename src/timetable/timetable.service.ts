import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { resolveActorDataScope } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import type { CreateTimetableSlotDto, UpdateTimetableSlotDto } from './dto/timetable.dto';
import { TimetableRepository } from './timetable.repository';
import type { TimetableSlotRow } from './timetable.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly repository: TimetableRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private toResponse(row: TimetableSlotRow) {
    return {
      id: row.id,
      school_term_id: row.school_term_id,
      school_id: row.school_id,
      grade_level_id: row.grade_level_id,
      room_no: row.room_no,
      day_of_week: row.day_of_week,
      period: row.period,
      subject_id: row.subject_id,
      subject_code: row.subject_code,
      subject_name_th: row.subject_name_th,
      teacher_user_id: row.teacher_user_id,
      teacher_name: row.teacher_name,
    };
  }

  private async assertSchoolAccess(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    const allowed = await this.repository.isSchoolInScope(schoolId, resolveActorDataScope(actor));
    if (!allowed) throw new ForbiddenException('โรงเรียนอยู่นอกขอบเขตของคุณ');
  }

  private assertClassScope(
    gradeLevelId: number,
    roomNo: number,
    actor: AuthenticatedRequestUser,
  ): void {
    const scope = resolveActorDataScope(actor);
    if (
      scope?.grade_levels?.length &&
      !scope.grade_levels.map(String).includes(String(gradeLevelId))
    ) {
      throw new ForbiddenException('ชั้นเรียนอยู่นอกขอบเขตของคุณ');
    }
    if (scope?.room_ids?.length && !scope.room_ids.map(String).includes(String(roomNo))) {
      throw new ForbiddenException('ห้องเรียนอยู่นอกขอบเขตของคุณ');
    }
  }

  async listForRoom(
    actor: AuthenticatedRequestUser,
    schoolId: number,
    gradeLevelId: number,
    roomNo: number,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    this.assertClassScope(gradeLevelId, roomNo, actor);
    const rows = await this.repository.listForRoom(schoolId, gradeLevelId, roomNo);
    return { success: true, data: rows.map((row) => this.toResponse(row)) };
  }

  async listSubjectsForRoom(
    actor: AuthenticatedRequestUser,
    schoolId: number,
    gradeLevelId: number,
    roomNo: number,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    this.assertClassScope(gradeLevelId, roomNo, actor);
    const rows = await this.repository.listDistinctSubjectsForRoom(schoolId, gradeLevelId, roomNo);
    return {
      success: true,
      data: rows.map((row) => ({
        subject_id: row.subject_id,
        code: row.code,
        name_th: row.name_th,
      })),
    };
  }

  async listTeacherCandidates(
    actor: AuthenticatedRequestUser,
    schoolId: number,
    searchTerm?: string,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    const rows = await this.repository.listTeacherCandidatesForSchool(schoolId, searchTerm);
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        display_name: row.display_name,
      })),
    };
  }

  /**
   * Role-aware "my schedule" view — a student always sees their own room
   * (resolved via current enrollment, ignoring any filters); a caller passing
   * `mine=true` sees only the periods they teach; everyone else gets the
   * explicit school/grade/room filters applied through their own data_scope.
   */
  async getMySchedule(
    actor: AuthenticatedRequestUser,
    filters: { schoolId?: number; gradeLevelId?: number; roomNo?: number; mine?: boolean },
  ) {
    if (actor.roles?.includes('STUDENT') && actor.student_uuid) {
      const room = await this.repository.resolveStudentRoom(actor.student_uuid);
      if (!room) {
        return { success: true, data: [] };
      }
      const rows = await this.repository.listForRoom(
        room.school_id,
        room.grade_level_id,
        room.room_no,
      );
      return { success: true, data: rows.map((row) => this.toResponse(row)) };
    }

    if (filters.mine) {
      const rows = await this.repository.listForTeacher(actor.id);
      return { success: true, data: rows.map((row) => this.toResponse(row)) };
    }

    if (
      filters.schoolId === undefined ||
      filters.gradeLevelId === undefined ||
      filters.roomNo === undefined
    ) {
      throw new BadRequestException('กรุณาระบุโรงเรียน ชั้น และห้อง');
    }
    return await this.listForRoom(actor, filters.schoolId, filters.gradeLevelId, filters.roomNo);
  }

  async create(actor: AuthenticatedRequestUser, dto: CreateTimetableSlotDto) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    this.assertClassScope(dto.gradeLevelId, dto.roomNo, actor);
    const actorId = resolveAuditActorId(actor);

    try {
      return await this.repository.withTransaction(async (queryRunner) => {
        const created = await this.repository.create(
          {
            schoolTermId: dto.schoolTermId,
            schoolId: dto.schoolId,
            gradeLevelId: dto.gradeLevelId,
            roomNo: dto.roomNo,
            dayOfWeek: dto.dayOfWeek,
            period: dto.period,
            subjectId: dto.subjectId,
            teacherUserId: dto.teacherUserId ?? null,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'TIMETABLE_SLOT_CREATE',
            targetType: 'timetable_slot',
            targetId: created.id,
            metadata: { dayOfWeek: dto.dayOfWeek, period: dto.period },
            ip: null,
          },
          queryRunner,
        );
        const row = await this.repository.findById(created.id);
        return { success: true, data: this.toResponse(row!) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('คาบนี้มีวิชาอยู่แล้วในห้องนี้');
      }
      throw error;
    }
  }

  async update(actor: AuthenticatedRequestUser, id: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException('ไม่พบคาบสอน');
    }
    await this.assertSchoolAccess(existing.school_id, actor);
    this.assertClassScope(existing.grade_level_id, existing.room_no, actor);
    const actorId = resolveAuditActorId(actor);

    return await this.repository.withTransaction(async (queryRunner) => {
      await this.repository.update(
        id,
        {
          subjectId: dto.subjectId,
          ...('teacherUserId' in dto ? { teacherUserId: dto.teacherUserId ?? null } : {}),
        },
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TIMETABLE_SLOT_UPDATE',
          targetType: 'timetable_slot',
          targetId: id,
          metadata: { dayOfWeek: existing.day_of_week, period: existing.period },
          ip: null,
        },
        queryRunner,
      );
      const row = await this.repository.findById(id);
      return { success: true, data: this.toResponse(row!) };
    });
  }

  async remove(actor: AuthenticatedRequestUser, id: string) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundException('ไม่พบคาบสอน');
    }
    await this.assertSchoolAccess(existing.school_id, actor);
    this.assertClassScope(existing.grade_level_id, existing.room_no, actor);
    const actorId = resolveAuditActorId(actor);

    await this.repository.withTransaction(async (queryRunner) => {
      await this.repository.softDelete(id, actorId, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TIMETABLE_SLOT_DELETE',
          targetType: 'timetable_slot',
          targetId: id,
          metadata: { dayOfWeek: existing.day_of_week, period: existing.period },
          ip: null,
        },
        queryRunner,
      );
    });
    return { success: true };
  }
}
