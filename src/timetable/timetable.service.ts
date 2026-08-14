import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { isStudentAccountActor, resolveActorDataScope } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import type {
  CreateTimetableSlotDto,
  GeneratePeriodTimesDto,
  OverridePeriodTimeDto,
  UpdateTimetableSlotDto,
} from './dto/timetable.dto';
import { TimetableRepository, type GeneratedPeriodTime } from './timetable.repository';
import type { SchoolPeriodTimeRow, TimetableSlotRow } from './timetable.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function parseHHMM(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Pure generator: period 1 starts at `firstPeriodStartsAt`, each period runs
 * `periodLengthMinutes`, with an optional break/lunch gap inserted right
 * after the given period number (owner-approved hybrid UX — see
 * tasks/task-ui-data-feedback-round.md §C follow-up).
 */
export function generatePeriodTimes(dto: GeneratePeriodTimesDto): GeneratedPeriodTime[] {
  const periods: GeneratedPeriodTime[] = [];
  let cursor = parseHHMM(dto.firstPeriodStartsAt);

  for (let period = 1; period <= dto.periodsCount; period += 1) {
    const startsAt = cursor;
    const endsAt = startsAt + dto.periodLengthMinutes;
    periods.push({ period, startsAt: formatHHMM(startsAt), endsAt: formatHHMM(endsAt) });
    cursor = endsAt;
    if (dto.breakAfterPeriod === period) {
      cursor += dto.breakMinutes ?? 0;
    }
    if (dto.lunchAfterPeriod === period) {
      cursor += dto.lunchMinutes ?? 0;
    }
  }

  return periods;
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
      grade_label: row.grade_label,
      room_no: row.room_no,
      day_of_week: row.day_of_week,
      period: row.period,
      subject_id: row.subject_id,
      subject_code: row.subject_code,
      subject_name_th: row.subject_name_th,
      teacher_user_id: row.teacher_user_id,
      teacher_membership_ids: (row.teacher_membership_ids ?? []).map(Number),
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

  private async assertPeriodTimesReadAccess(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    if (isStudentAccountActor(actor)) {
      const room = actor.student_uuid
        ? await this.repository.resolveStudentRoom(actor.student_uuid)
        : null;
      if (!room || room.school_id !== schoolId) {
        throw new ForbiddenException('โรงเรียนอยู่นอกขอบเขตของคุณ');
      }
      return;
    }
    await this.assertSchoolAccess(schoolId, actor);
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

  private async assertTeacherMembershipsEligible(
    input: {
      schoolId: number;
      gradeLevelId: number;
      roomNo: number;
      subjectId: number;
      teacherMembershipIds: number[];
    },
    queryRunner: Parameters<TimetableRepository['replaceSlotTeachers']>[2],
  ): Promise<void> {
    const selectedIds = [...new Set(input.teacherMembershipIds)];
    const eligibleIds = await this.repository.listEligibleTeacherMembershipIds(
      { ...input, teacherMembershipIds: selectedIds },
      queryRunner,
    );
    if (eligibleIds.length !== selectedIds.length) {
      throw new BadRequestException('ผู้สอนที่เลือกไม่อยู่ในรายชื่อครูผู้สอนที่ใช้งานของวิชานี้');
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
    const rows = await this.repository.listDistinctSubjectsForRoom(schoolId, gradeLevelId);
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
    subjectId?: number,
    gradeLevelId?: number,
    roomNo?: number,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    const rows = await this.repository.listTeacherCandidatesForSchool(
      schoolId,
      searchTerm,
      subjectId,
      gradeLevelId,
      roomNo,
    );
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
    if (isStudentAccountActor(actor) && actor.student_uuid) {
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
      const teacherUserId = actor.id && actor.id > 0 ? actor.id : null;
      const teacherMembershipId = actor.teacher_membership_id ?? null;
      const rows = await this.repository.listForTeacher(teacherUserId, teacherMembershipId);
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
        if (
          dto.teacherUserId != null &&
          !(await this.repository.isActiveTeacherForSchool(
            dto.teacherUserId,
            dto.schoolId,
            queryRunner,
          ))
        ) {
          throw new BadRequestException('ผู้สอนไม่ใช่ครูที่ใช้งานของโรงเรียนนี้');
        }
        const created = await this.repository.create(
          {
            schoolTermId: dto.schoolTermId,
            schoolId: dto.schoolId,
            gradeLevelId: dto.gradeLevelId,
            roomNo: dto.roomNo,
            dayOfWeek: dto.dayOfWeek,
            period: dto.period,
            subjectId: dto.subjectId,
            // The join table is authoritative whenever the modern payload is
            // present. Do not persist a second, potentially conflicting legacy
            // pointer even if an older client sends both fields.
            teacherUserId:
              dto.teacherMembershipIds !== undefined ? null : (dto.teacherUserId ?? null),
            actorId,
          },
          queryRunner,
        );
        if (!created?.id) {
          throw new BadRequestException('สร้างคาบสอนไม่สำเร็จ');
        }
        if (dto.teacherMembershipIds !== undefined) {
          await this.assertTeacherMembershipsEligible(
            {
              schoolId: dto.schoolId,
              gradeLevelId: dto.gradeLevelId,
              roomNo: dto.roomNo,
              subjectId: dto.subjectId,
              teacherMembershipIds: dto.teacherMembershipIds,
            },
            queryRunner,
          );
          await this.repository.replaceSlotTeachers(
            created.id,
            dto.teacherMembershipIds,
            queryRunner,
          );
        }
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
        const row = await this.repository.findById(created.id, queryRunner);
        if (!row) {
          throw new BadRequestException('ไม่พบคาบสอนหลังสร้าง');
        }
        return { success: true, data: this.toResponse(row) };
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
      if (
        dto.teacherUserId != null &&
        !(await this.repository.isActiveTeacherForSchool(
          dto.teacherUserId,
          existing.school_id,
          queryRunner,
        ))
      ) {
        throw new BadRequestException('ผู้สอนไม่ใช่ครูที่ใช้งานของโรงเรียนนี้');
      }
      // Reassigning teacherMembershipIds must also clear the legacy teacher_user_id
      // / teacher_membership_id columns on the slot — otherwise a stale pointer to
      // the previous teacher lingers and listForTeacher()'s legacy-fallback match
      // resurfaces this slot on their schedule alongside their real one, showing
      // as a phantom double-booking at the same day/period.
      const clearingLegacyTeacherColumns =
        'teacherUserId' in dto || dto.teacherMembershipIds !== undefined;
      await this.repository.update(
        id,
        {
          subjectId: dto.subjectId,
          ...(clearingLegacyTeacherColumns ? { teacherUserId: dto.teacherUserId ?? null } : {}),
        },
        actorId,
        queryRunner,
      );
      if (dto.teacherMembershipIds !== undefined) {
        await this.assertTeacherMembershipsEligible(
          {
            schoolId: existing.school_id,
            gradeLevelId: existing.grade_level_id,
            roomNo: existing.room_no,
            subjectId: dto.subjectId ?? existing.subject_id,
            teacherMembershipIds: dto.teacherMembershipIds,
          },
          queryRunner,
        );
        await this.repository.replaceSlotTeachers(id, dto.teacherMembershipIds, queryRunner);
      }
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
      const row = await this.repository.findById(id, queryRunner);
      if (!row) {
        throw new BadRequestException('ไม่พบคาบสอนหลังแก้ไข');
      }
      return { success: true, data: this.toResponse(row) };
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

  private toPeriodTimeResponse(row: SchoolPeriodTimeRow) {
    return {
      id: row.id,
      school_id: row.school_id,
      day_of_week: row.day_of_week,
      period: row.period,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      source: row.source,
    };
  }

  async listPeriodTimes(actor: AuthenticatedRequestUser, schoolId: number) {
    await this.assertPeriodTimesReadAccess(schoolId, actor);
    const rows = await this.repository.listPeriodTimesForSchool(schoolId);
    return { success: true, data: rows.map((row) => this.toPeriodTimeResponse(row)) };
  }

  async generatePeriodTimesForSchool(actor: AuthenticatedRequestUser, dto: GeneratePeriodTimesDto) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    const periods = generatePeriodTimes(dto);
    const actorId = resolveAuditActorId(actor);

    // Guards and replace share one transaction so a slot assigned between
    // the check and the write can't slip past the orphan detection below —
    // a throw rolls the whole regenerate back.
    await this.repository.withTransaction(async (queryRunner) => {
      // Regenerating only replaces `school_period_times` — it never touches
      // `timetable_slots`. Without this check, shrinking the period count
      // silently leaves rooms with subjects assigned to a period the bell
      // schedule no longer defines, with no warning at all.
      const orphanedSlotCount = await this.repository.countSlotsOutsidePeriods(
        dto.schoolId,
        dto.daysOfWeek,
        periods.map((p) => p.period),
        queryRunner,
      );
      if (orphanedSlotCount > 0) {
        throw new ConflictException(
          `มีวิชาที่มอบหมายไว้ในคาบที่จะหายไป ${orphanedSlotCount} รายการ กรุณาลบหรือย้ายวิชาเหล่านั้นในตารางสอนก่อน แล้วจึงตั้งเวลาคาบเรียนใหม่`,
        );
      }

      // A day unchecked in "ใช้กับวัน" isn't touched by the replace above —
      // its old bell schedule would otherwise linger forever even though it's
      // no longer part of what was just generated. Clear it too, guarded the
      // same way: block if that would orphan a subject still assigned on that
      // day (any period), so removing a day can't silently strand data either.
      const existingDays = await this.repository.listDaysWithPeriodTimes(dto.schoolId, queryRunner);
      const droppedDays = existingDays.filter((day) => !dto.daysOfWeek.includes(day));
      if (droppedDays.length > 0) {
        const orphanedDayCount = await this.repository.countSlotsOutsidePeriods(
          dto.schoolId,
          droppedDays,
          [],
          queryRunner,
        );
        if (orphanedDayCount > 0) {
          throw new ConflictException(
            `มีวิชาที่มอบหมายไว้ในวันที่จะถูกเอาออกจากตารางเวลา ${orphanedDayCount} รายการ กรุณาลบหรือย้ายวิชาเหล่านั้นในตารางสอนก่อน แล้วจึงตั้งเวลาคาบเรียนใหม่`,
          );
        }
        await this.repository.replacePeriodTimesForDays(
          dto.schoolId,
          droppedDays,
          [],
          actorId,
          queryRunner,
        );
      }
      await this.repository.replacePeriodTimesForDays(
        dto.schoolId,
        dto.daysOfWeek,
        periods,
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'PERIOD_TIME_GENERATE',
          targetType: 'school_period_times',
          targetId: String(dto.schoolId),
          metadata: { days: dto.daysOfWeek, periodsCount: dto.periodsCount, droppedDays },
          ip: null,
        },
        queryRunner,
      );
    });

    return await this.listPeriodTimes(actor, dto.schoolId);
  }

  async overridePeriodTime(actor: AuthenticatedRequestUser, dto: OverridePeriodTimeDto) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    if (parseHHMM(dto.startsAt) >= parseHHMM(dto.endsAt)) {
      throw new BadRequestException('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    }
    const actorId = resolveAuditActorId(actor);

    await this.repository.withTransaction(async (queryRunner) => {
      await this.repository.upsertPeriodTimeOverride(
        dto.schoolId,
        dto.dayOfWeek,
        dto.period,
        dto.startsAt,
        dto.endsAt,
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'PERIOD_TIME_OVERRIDE',
          targetType: 'school_period_times',
          targetId: String(dto.schoolId),
          metadata: { dayOfWeek: dto.dayOfWeek, period: dto.period },
          ip: null,
        },
        queryRunner,
      );
    });

    return await this.listPeriodTimes(actor, dto.schoolId);
  }
}
