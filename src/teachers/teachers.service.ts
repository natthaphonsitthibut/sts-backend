import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser, DataScope } from '../auth';
import type { ConfigType } from '@nestjs/config';
import {
  hasAreaDataScope,
  hasPermission,
  isUnconfiguredDataScope,
  normalizeDataScope,
} from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { buildPiiSubjectRef } from '../common/utils/pii-ref.util';
import { piiConfig } from '../config/pii.config';
import {
  maskNationalIdValue,
  normalizeNationalIdValue,
  PII_REASON_CODES,
  PII_REASON_REQUIRES_NOTE,
  type PiiReasonCode,
} from '../students/pii-fields.config';
import type { PiiRevealDto } from '../students/dto/pii-reveal.dto';
import { processImageUpload } from '../common/file-upload/visit-photo.util';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  CreateTeacherDto,
  DeactivateTeacherDto,
  ListTeachersQueryDto,
  UpdateTeacherDto,
} from './dto/teachers.dto';
import { TeachersRepository } from './teachers.repository';
import type { TeacherRow } from './teachers.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Teachers carry two unique identities, so the message has to name the one that
 * actually clashed — telling someone their national id is taken when the email
 * is the problem sends them looking in the wrong place.
 */
function uniqueViolationMessage(error: unknown): string {
  const constraint =
    typeof error === 'object' && error !== null && 'constraint' in error
      ? String(error.constraint)
      : '';
  if (constraint === 'uq_teachers_email') return 'อีเมลนี้ถูกใช้กับครูคนอื่นแล้ว';
  if (constraint === 'uq_teachers_citizen_id') return 'เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว';
  return 'ข้อมูลนี้ซ้ำกับครูคนอื่นในระบบแล้ว';
}

@Injectable()
export class TeachersService {
  private readonly logger = new Logger(TeachersService.name);

  constructor(
    private readonly repository: TeachersRepository,
    private readonly auditLog: AuditLogService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    @Inject(piiConfig.KEY)
    private readonly piiRuntimeConfig: ConfigType<typeof piiConfig>,
  ) {}

  /**
   * Teacher records are school-owned personnel data, so the actor needs the
   * teacher permission AND a scope that resolves to whole schools. A grade- or
   * room-limited account manages students, not the school's staff roster.
   */
  private resolveScope(actor: AuthenticatedRequestUser): DataScope {
    if (!hasPermission(actor.roles, actor.permissions, 'manage-teachers')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการข้อมูลครู');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการข้อมูลครูระดับโรงเรียน');
    }
    if (scope.global !== true && !hasAreaDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตโรงเรียนที่ใช้งานได้');
    }
    return scope;
  }

  private async assertSchoolAccess(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    const allowed = await this.repository.isSchoolInScope(schoolId, this.resolveScope(actor));
    if (!allowed) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
  }

  private toResponse(row: TeacherRow) {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`.trim(),
      citizenId: row.citizen_id ? maskNationalIdValue(row.citizen_id) : null,
      maskedFields: row.citizen_id ? ['citizenId'] : [],
      phone: row.phone,
      email: row.email,
      lineId: row.line_id,
      photoUrl: row.photo_storage_key
        ? `/api/teachers/${row.id}/photo?v=${encodeURIComponent(row.updated_at)}`
        : null,
      teacherStatus: row.teacher_status,
      membershipId: row.membership_id,
      schoolId: row.school_id,
      membershipStatus: row.membership_status,
      startedOn: row.started_on,
      endedOn: row.ended_on,
    };
  }

  private async findProfileTeacher(
    teacherId: string,
    actor: AuthenticatedRequestUser,
  ): Promise<TeacherRow> {
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    const hasWholeSchoolTeacherScope =
      scope.own_only !== true &&
      !isUnconfiguredDataScope(scope) &&
      (scope.grade_levels?.length ?? 0) === 0 &&
      (scope.room_ids?.length ?? 0) === 0 &&
      (scope.global === true || hasAreaDataScope(scope));

    if (
      ['teachers', 'manage-teachers'].some((permission) =>
        hasPermission(actor.roles, actor.permissions, permission),
      ) &&
      hasWholeSchoolTeacherScope
    ) {
      const teacher = await this.repository.findTeacherById(teacherId);
      if (!teacher) throw new NotFoundException('ไม่พบข้อมูลครู');
      const allowed = await this.repository.isSchoolInScope(teacher.school_id, scope);
      if (!allowed) throw new NotFoundException('ไม่พบข้อมูลครู');
      return teacher;
    }

    if (!hasPermission(actor.roles, actor.permissions, 'manage-classroom-links')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูข้อมูลครู');
    }
    if (scope.own_only === true || isUnconfiguredDataScope(scope)) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ดูข้อมูลครู');
    }
    const teacher = await this.repository.findActiveHomeroomTeacherInScope(teacherId, scope);
    if (!teacher) throw new NotFoundException('ไม่พบข้อมูลครู');
    return teacher;
  }

  private toProfileResponse(row: TeacherRow) {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`.trim(),
      citizenId: row.citizen_id ? maskNationalIdValue(row.citizen_id) : null,
      maskedFields: row.citizen_id ? ['citizenId'] : [],
      phone: row.phone,
      email: row.email,
      lineId: row.line_id,
      photoUrl: row.photo_storage_key
        ? `/api/teacher-profiles/${row.id}/photo?v=${encodeURIComponent(row.updated_at)}`
        : null,
      teacherStatus: row.teacher_status,
      schoolId: row.school_id,
      membershipStatus: row.membership_status,
    };
  }

  async findProfile(teacherId: string, actor: AuthenticatedRequestUser) {
    const teacher = await this.findProfileTeacher(teacherId, actor);
    return { success: true, data: this.toProfileResponse(teacher) };
  }

  async listProfiles(query: ListTeachersQueryDto, actor: AuthenticatedRequestUser) {
    if (
      !['teachers', 'manage-teachers'].some((permission) =>
        hasPermission(actor.roles, actor.permissions, permission),
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูรายชื่อครู');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0 ||
      (scope.global !== true && !hasAreaDataScope(scope))
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ดูรายชื่อครูระดับโรงเรียน');
    }
    const allowed = await this.repository.isSchoolInScope(query.schoolId, scope);
    if (!allowed) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listTeachers({
      schoolId: query.schoolId,
      searchTerm: query.searchTerm?.trim() || undefined,
      teacherStatus: query.teacherStatus,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page,
      limit,
    });
    return {
      success: true,
      data: rows.map((row) => this.toProfileResponse(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async resolveProfilePhoto(
    teacherId: string,
    actor: AuthenticatedRequestUser,
  ): Promise<FileServeResult> {
    const teacher = await this.findProfileTeacher(teacherId, actor);
    if (!teacher.photo_storage_key) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    const result = await this.storage.resolve(teacher.photo_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    return result;
  }

  async revealNationalId(
    teacherId: string,
    actor: AuthenticatedRequestUser,
    dto: PiiRevealDto,
    meta: { requestId: string | null; ip: string | null; userAgent: string | null },
  ) {
    if (
      !['teachers', 'manage-teachers'].some((permission) =>
        hasPermission(actor.roles, actor.permissions, permission),
      )
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์เปิดดูเลขบัตรครู');
    }
    if (dto.field_group !== 'NATIONAL_ID') {
      throw new BadRequestException('field_group must be NATIONAL_ID');
    }
    if (
      !dto.reason_code ||
      dto.reason_code === 'SELF_ACCESS' ||
      !PII_REASON_CODES.includes(dto.reason_code as PiiReasonCode)
    ) {
      throw new BadRequestException('valid reason_code is required');
    }
    const reasonCode = dto.reason_code as PiiReasonCode;
    const reasonNote = dto.reason_note?.trim() || null;
    if (PII_REASON_REQUIRES_NOTE.includes(reasonCode) && !reasonNote) {
      throw new BadRequestException('reason_note is required for this reason code');
    }
    if (reasonNote && /\d(?:[\s-]*\d){9,}/u.test(reasonNote)) {
      throw new BadRequestException('reason_note must not contain ID or document numbers');
    }

    const teacher = await this.findProfileTeacher(teacherId, actor);
    const citizenId = normalizeNationalIdValue(teacher.citizen_id);
    if (!citizenId) throw new NotFoundException('ไม่พบเลขบัตรประชาชนครู');
    const subjectRef = buildPiiSubjectRef(
      `teacher:${teacherId}`,
      this.piiRuntimeConfig.hashPepper,
      this.piiRuntimeConfig.hashKeyVersion,
    );
    const activeGroups = await this.repository.listActivePiiRevealGroups(
      actor.id,
      subjectRef,
      this.piiRuntimeConfig.revealTtlSeconds,
    );
    if (!activeGroups.includes('NATIONAL_ID')) {
      await this.repository.insertPiiAccessEvent({
        actorUserId: resolveAuditActorId(actor),
        actorRoles: actor.roles,
        subjectRef,
        subjectRefKeyVersion: this.piiRuntimeConfig.hashKeyVersion,
        reasonCode,
        reasonNote,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return { field_group: 'NATIONAL_ID', values: { citizenId } };
  }

  async list(query: ListTeachersQueryDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listTeachers({
      schoolId: query.schoolId,
      searchTerm: query.searchTerm?.trim() || undefined,
      teacherStatus: query.teacherStatus,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page,
      limit,
    });
    return {
      success: true,
      data: rows.map((row) => this.toResponse(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async findOne(teacherId: string, actor: AuthenticatedRequestUser) {
    const teacher = await this.repository.findTeacherById(teacherId);
    if (!teacher) throw new NotFoundException('ไม่พบข้อมูลครู');
    await this.assertSchoolAccess(teacher.school_id, actor);
    return { success: true, data: this.toResponse(teacher) };
  }

  /**
   * Adding a teacher who already exists (same national id) attaches a membership
   * for the new school instead of creating a second person — that is how a
   * transfer between schools is represented.
   */
  async create(dto: CreateTeacherDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    const actorId = resolveAuditActorId(actor);
    try {
      const created = await this.repository.withTransaction(async (queryRunner) => {
        const existing = dto.citizenId
          ? await this.repository.findTeacherByCitizenId(dto.citizenId, queryRunner)
          : null;

        if (existing) {
          const activeMembership = await this.repository.findActiveMembership(
            existing.id,
            dto.schoolId,
            queryRunner,
          );
          if (activeMembership) {
            throw new ConflictException('ครูคนนี้อยู่ในรายชื่อครูของโรงเรียนแล้ว');
          }
        }

        const teacherId =
          existing?.id ??
          (
            await this.repository.createTeacher(
              {
                firstName: dto.firstName,
                lastName: dto.lastName,
                citizenId: dto.citizenId ?? null,
                phone: dto.phone ?? null,
                email: dto.email ?? null,
                lineId: dto.lineId ?? null,
                actorId,
              },
              queryRunner,
            )
          ).id;

        if (existing?.teacher_status === 'INACTIVE') {
          await this.repository.reactivateTeacher(existing.id, actorId, queryRunner);
        }

        const membership = await this.repository.createMembership(
          { teacherId, schoolId: dto.schoolId, actorId },
          queryRunner,
        );

        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'teachers',
            targetId: teacherId,
            metadata: {
              op: existing ? 'attach' : 'create',
              reactivated: existing?.teacher_status === 'INACTIVE',
              schoolId: dto.schoolId,
              teacherId,
              teacherMembershipId: membership.id,
            },
            ip: null,
          },
          queryRunner,
        );

        const row = await this.repository.findTeacherById(teacherId, queryRunner);
        if (!row) throw new NotFoundException('ไม่พบข้อมูลครูหลังบันทึก');
        return row;
      });
      return { success: true, data: this.toResponse(created) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(uniqueViolationMessage(error));
      }
      throw error;
    }
  }

  async update(teacherId: string, dto: UpdateTeacherDto, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    const changedFields = Object.keys(dto);
    if (changedFields.length === 0) {
      throw new BadRequestException('ไม่มีข้อมูลที่ต้องแก้ไข');
    }
    try {
      const updated = await this.repository.withTransaction(async (queryRunner) => {
        const existing = await this.repository.findTeacherById(teacherId, queryRunner);
        if (!existing) throw new NotFoundException('ไม่พบข้อมูลครู');
        await this.assertSchoolAccess(existing.school_id, actor);

        await this.repository.updateTeacher(
          teacherId,
          {
            firstName: dto.firstName,
            lastName: dto.lastName,
            citizenId: dto.citizenId,
            phone: dto.phone,
            email: dto.email,
            lineId: dto.lineId,
            actorId,
          },
          queryRunner,
        );

        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'teachers',
            targetId: teacherId,
            metadata: {
              op: 'update',
              schoolId: existing.school_id,
              teacherId,
              teacherMembershipId: existing.membership_id,
              changedFields,
            },
            ip: null,
          },
          queryRunner,
        );

        const row = await this.repository.findTeacherById(teacherId, queryRunner);
        if (!row) throw new NotFoundException('ไม่พบข้อมูลครูหลังบันทึก');
        return row;
      });
      return { success: true, data: this.toResponse(updated) };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(uniqueViolationMessage(error));
      }
      throw error;
    }
  }

  /**
   * Replaces or clears the profile photo. The upload is processed before the
   * transaction and cleaned up if the write fails, so storage never keeps an
   * orphan; the replaced object is deleted only once the row actually points at
   * the new one.
   */
  async updatePhoto(
    teacherId: string,
    actor: AuthenticatedRequestUser,
    file?: Express.Multer.File,
    removePhoto?: boolean,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (file && removePhoto) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    if (!file && !removePhoto) {
      throw new BadRequestException('กรุณาเลือกรูปหรือระบุการนำรูปออก');
    }

    const existing = await this.repository.findTeacherById(teacherId);
    if (!existing) throw new NotFoundException('ไม่พบข้อมูลครู');
    await this.assertSchoolAccess(existing.school_id, actor);

    const newStorageKey = file
      ? await processImageUpload(file, this.storage, 'teacher-photos')
      : null;
    let replacedStorageKey: string | null = null;

    try {
      await this.repository.withTransaction(async (queryRunner) => {
        const teacher = await this.repository.findTeacherById(teacherId, queryRunner);
        if (!teacher) throw new NotFoundException('ไม่พบข้อมูลครู');
        await this.assertSchoolAccess(teacher.school_id, actor);
        replacedStorageKey = teacher.photo_storage_key;

        await this.repository.updateTeacherPhoto(teacherId, newStorageKey, actorId, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'teachers',
            targetId: teacherId,
            metadata: {
              op: newStorageKey ? 'update-photo' : 'remove-photo',
              schoolId: teacher.school_id,
              teacherId,
              teacherMembershipId: teacher.membership_id,
            },
            ip: null,
          },
          queryRunner,
        );
      });
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(`Unable to delete unused teacher photo for teacher ${teacherId}`);
        });
      }
      throw error;
    }

    if (replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced teacher photo for teacher ${teacherId}`);
      });
    }

    const updated = await this.repository.findTeacherById(teacherId);
    if (!updated) throw new NotFoundException('ไม่พบข้อมูลครูหลังบันทึก');
    return { success: true, data: this.toResponse(updated) };
  }

  /**
   * Photos are private personnel data, so reads go through the scope check and
   * then the storage adapter — which hands back a short-lived signed URL on
   * object storage, or a local path in development. Never a public URL.
   */
  async resolvePhoto(teacherId: string, actor: AuthenticatedRequestUser): Promise<FileServeResult> {
    const teacher = await this.repository.findTeacherById(teacherId);
    if (!teacher?.photo_storage_key) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    await this.assertSchoolAccess(teacher.school_id, actor);
    const result = await this.storage.resolve(teacher.photo_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    return result;
  }

  /** Soft delete — ends the school membership and keeps every historical row. */
  async deactivate(teacherId: string, dto: DeactivateTeacherDto, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findTeacherById(teacherId, queryRunner);
      if (!existing) throw new NotFoundException('ไม่พบข้อมูลครู');
      await this.assertSchoolAccess(existing.school_id, actor);
      if (existing.membership_status !== 'ACTIVE') {
        throw new BadRequestException('ครูคนนี้ถูกปิดใช้งานไปแล้ว');
      }

      await this.repository.deactivateTeacher(
        { teacherId, membershipId: existing.membership_id, actorId },
        queryRunner,
      );

      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'teachers',
          targetId: teacherId,
          metadata: {
            op: 'deactivate',
            schoolId: existing.school_id,
            teacherId,
            teacherMembershipId: existing.membership_id,
            note: dto.note ?? null,
          },
          ip: null,
        },
        queryRunner,
      );
    });
    return { success: true };
  }
}
