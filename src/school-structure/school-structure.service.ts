import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  hasAreaDataScope,
  isClassInScope,
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { hasPermission } from '../auth/permissions.constants';
import { attendanceStatusFromCode } from '../attendance/attendance-status';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { processImageUpload } from '../common/file-upload/visit-photo.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  AuthorizeClassroomExportDto,
  CreateClassroomTeacherAssignmentDto,
  CreateClassroomStudentCommentDto,
  CreateSchoolClassroomDto,
  CreateSchoolTeacherMembershipDto,
  ListClassroomRosterDto,
  ListClassroomAttendanceHistoryDto,
  ListSchoolClassroomOptionsDto,
  ListSchoolClassroomsDto,
  ListSchoolTeacherCandidatesDto,
  ListSchoolTeachersDto,
  SetClassroomHomeroomTeachersDto,
  UpdateSchoolClassroomDto,
  UpdateClassroomPresentationDto,
  UpdateSchoolTeacherMembershipDto,
} from './dto/school-structure.dto';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import { SchoolStructureRepository } from './school-structure.repository';
import type { ClassroomStudentProblemCategory } from './classroom-student-comment.constants';
import type {
  ClassroomTeacherAssignmentRow,
  SchoolClassroomRow,
  SchoolTeacherMembershipRow,
} from './school-structure.types';

function databaseErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

function roomNumberFromCode(roomCode: string): number {
  const normalized = roomCode.trim();
  const roomNumber = Number(normalized);
  if (
    !/^[1-9][0-9]*$/.test(normalized) ||
    !Number.isInteger(roomNumber) ||
    roomNumber > POSTGRES_INTEGER_MAX
  ) {
    throw new BadRequestException('รหัสห้องต้องเป็นเลขจำนวนเต็มบวกไม่เกิน 2147483647');
  }
  return roomNumber;
}

@Injectable()
export class SchoolStructureService {
  private readonly logger = new Logger(SchoolStructureService.name);

  constructor(
    private readonly repository: SchoolStructureRepository,
    private readonly auditLog: AuditLogService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    private readonly riskProfileService: RiskProfileService,
  ) {}

  private resolveScope(actor: AuthenticatedRequestUser, allowRelatedRead = false): DataScope {
    const canManageStructure = hasPermission(
      actor.roles,
      actor.permissions,
      'manage-school-structure',
    );
    const canUseRelatedRead =
      allowRelatedRead &&
      [
        'manage-classroom-links',
        'import-data',
        'manage-role-groups',
        // จัดการข้อมูลครู reuses this endpoint for its school picker.
        'teachers',
      ].some((permission) => hasPermission(actor.roles, actor.permissions, permission));
    if (!canManageStructure && !canUseRelatedRead) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการโครงสร้างโรงเรียน');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการโครงสร้างระดับโรงเรียน');
    }
    if (scope.global !== true && !hasAreaDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตโรงเรียนที่ใช้งานได้');
    }
    return scope;
  }

  private async assertSchoolAccess(
    schoolId: number,
    actor: AuthenticatedRequestUser,
    allowRelatedRead = false,
  ): Promise<void> {
    const allowed = await this.repository.isSchoolInScope(
      schoolId,
      this.resolveScope(actor, allowRelatedRead),
    );
    if (!allowed) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
  }

  private resolveCommentScope(actor: AuthenticatedRequestUser): DataScope {
    const canComment = ['classrooms', 'manage-school-structure', 'attendance', 'students'].some(
      (permission) => hasPermission(actor.roles, actor.permissions, permission),
    );
    if (!canComment) {
      throw new ForbiddenException('ไม่มีสิทธิ์บันทึกความคิดเห็นนักเรียน');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (scope.own_only === true || isUnconfiguredDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตนักเรียนที่ใช้งานได้');
    }
    if (scope.global !== true && !hasAreaDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตนักเรียนที่ใช้งานได้');
    }
    return scope;
  }

  private async assertClassroomCommentAccess(
    classroom: SchoolClassroomRow,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    const scope = this.resolveCommentScope(actor);
    const schoolAllowed = await this.repository.isSchoolInScope(classroom.school_id, scope);
    const classroomAllowed = isClassInScope(scope, {
      gradeLevelId: classroom.grade_level_id,
      roomId: classroom.id,
    });
    if (!schoolAllowed || !classroomAllowed) {
      throw new NotFoundException('ไม่พบห้องเรียนในขอบเขตของคุณ');
    }
  }

  private toClassroom(row: SchoolClassroomRow) {
    return {
      id: row.id,
      schoolTermId: row.school_term_id,
      schoolId: row.school_id,
      academicYear: row.academic_year,
      semester: row.semester,
      gradeLevelId: row.grade_level_id,
      gradeLabel: row.grade_label,
      legacyRoomNumber: row.legacy_room_number,
      roomCode: row.room_code,
      roomName: row.room_name,
      classroomStatus: row.classroom_status,
      cardCoverColor: row.card_cover_color,
      coverImageUrl: row.cover_image_storage_key
        ? `/api/school-structure/classrooms/${row.id}/cover?v=${encodeURIComponent(
            new Date(row.updated_at).toISOString(),
          )}`
        : null,
      coverImagePositionX: row.cover_image_position_x,
      coverImagePositionY: row.cover_image_position_y,
      coverImageScale: Number(row.cover_image_scale),
      isFavorite: row.is_favorite,
      homeroomTeacherName: row.homeroom_teacher_name ?? null,
      homeroomTeachers: row.homeroom_teachers ?? [],
      studentCount: Number(row.student_count),
    };
  }

  private toTeacher(row: SchoolTeacherMembershipRow) {
    return {
      id: row.id,
      schoolId: row.school_id,
      teacherId: row.teacher_id,
      displayName: row.display_name,
      membershipStatus: row.membership_status,
      startedOn: row.started_on,
      endedOn: row.ended_on,
    };
  }

  private toAssignment(row: ClassroomTeacherAssignmentRow) {
    return {
      id: row.id,
      schoolId: row.school_id,
      classroomId: row.classroom_id,
      teacherMembershipId: row.teacher_membership_id,
      teacherId: row.teacher_id,
      teacherName: row.teacher_name,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      assignmentKind: row.assignment_kind,
      assignmentStatus: row.assignment_status,
      effectiveOn: row.effective_on,
      effectiveUntil: row.effective_until,
      isPrimary: row.is_primary ?? false,
    };
  }

  async listSchools(actor: AuthenticatedRequestUser) {
    const rows = await this.repository.listScopedSchools(this.resolveScope(actor, true));
    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        province: row.province,
        district: row.district,
        subDistrict: row.sub_district,
      })),
    };
  }

  async listClassrooms(query: ListSchoolClassroomsDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor, true);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount, teacherCount, studentCount } = await this.repository.listClassrooms({
      schoolId: query.schoolId,
      userId: resolveAuditActorId(actor),
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      classroomId: query.classroomId,
      search: query.search,
      sortBy: query.sortBy ?? 'grade',
      sortDirection: query.sortDirection ?? 'asc',
      page,
      limit,
    });
    return {
      data: rows.map((row) => this.toClassroom(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
      summary: {
        classroomCount: totalCount,
        teacherCount,
        studentCount,
      },
    };
  }

  async setClassroomFavorite(
    classroomId: number,
    isFavorite: boolean,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (!actorId) throw new ForbiddenException('บัญชีนี้ไม่รองรับการปักดาวห้องเรียน');
    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor, true);
    await this.repository.setClassroomFavorite(actorId, classroomId, isFavorite);
    return { data: { classroomId: String(classroomId), isFavorite } };
  }

  async updateClassroomPresentation(
    classroomId: number,
    dto: UpdateClassroomPresentationDto,
    actor: AuthenticatedRequestUser,
    file?: Express.Multer.File,
  ) {
    this.resolveScope(actor);
    const actorId = resolveAuditActorId(actor);
    if (!actorId) throw new ForbiddenException('บัญชีนี้ไม่รองรับการปรับแต่งห้องเรียน');
    if (file && dto.removeCover) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    const hasPresentationChange =
      dto.cardCoverColor !== undefined ||
      dto.coverImagePositionX !== undefined ||
      dto.coverImagePositionY !== undefined ||
      dto.coverImageScale !== undefined ||
      dto.removeCover === true ||
      Boolean(file);
    if (!hasPresentationChange) {
      throw new BadRequestException('กรุณาระบุการปรับแต่งอย่างน้อยหนึ่งรายการ');
    }

    const existing = await this.repository.findClassroomById(classroomId);
    if (!existing) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(existing.school_id, actor);

    const newStorageKey = file
      ? await processImageUpload(file, this.storage, 'classroom-covers')
      : undefined;
    let replacedStorageKey: string | null = null;
    try {
      await this.repository.withTransaction(async (queryRunner) => {
        const classroom = await this.repository.findClassroomById(classroomId, queryRunner);
        if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
        await this.assertSchoolAccess(classroom.school_id, actor);
        replacedStorageKey = classroom.cover_image_storage_key;
        const coverImageStorageKey =
          newStorageKey !== undefined
            ? newStorageKey
            : dto.removeCover
              ? null
              : classroom.cover_image_storage_key;
        await this.repository.updateClassroomPresentation(
          classroomId,
          {
            cardCoverColor: dto.cardCoverColor ?? classroom.card_cover_color,
            coverImageStorageKey,
            coverImagePositionX: dto.coverImagePositionX ?? classroom.cover_image_position_x,
            coverImagePositionY: dto.coverImagePositionY ?? classroom.cover_image_position_y,
            coverImageScale: dto.coverImageScale ?? Number(classroom.cover_image_scale),
          },
          actorId,
          queryRunner,
        );
        const changedFields = [
          ...(dto.cardCoverColor !== undefined ? ['cardCoverColor'] : []),
          ...(dto.coverImagePositionX !== undefined ||
          dto.coverImagePositionY !== undefined ||
          dto.coverImageScale !== undefined
            ? ['coverImageFraming']
            : []),
          ...(newStorageKey !== undefined || dto.removeCover ? ['coverImage'] : []),
        ];
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'school_classrooms',
            targetId: String(classroomId),
            metadata: {
              op: 'update-presentation',
              schoolId: classroom.school_id,
              changedFields,
            },
            ip: null,
          },
          queryRunner,
        );
      });
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(`Unable to delete unused classroom cover for classroom ${classroomId}`);
        });
      }
      throw error;
    }
    if ((newStorageKey || dto.removeCover) && replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced classroom cover for classroom ${classroomId}`);
      });
    }
    const updated = await this.repository.findClassroomById(classroomId);
    return { data: this.toClassroom(updated!) };
  }

  async resolveClassroomCover(
    classroomId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<FileServeResult> {
    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom?.cover_image_storage_key) throw new NotFoundException('ไม่พบรูปห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor, true);
    const result = await this.storage.resolve(classroom.cover_image_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปห้องเรียน');
    return result;
  }

  async authorizeClassroomExport(
    classroomId: number,
    dto: AuthorizeClassroomExportDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (Boolean(dto.dateFrom) !== Boolean(dto.dateTo)) {
      throw new BadRequestException('dateFrom and dateTo must be provided together');
    }
    if (dto.dateFrom && dto.dateTo && dto.dateFrom > dto.dateTo) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    this.resolveScope(actor);
    if (!hasPermission(actor.roles, actor.permissions, 'export-data')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ส่งออกข้อมูล');
    }
    const actorId = resolveAuditActorId(actor);
    if (!actorId) throw new ForbiddenException('บัญชีนี้ไม่รองรับการส่งออกข้อมูล');
    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor);

    await this.repository.withTransaction(async (queryRunner) => {
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_DATA_EXPORT',
          targetType: 'school_classrooms',
          targetId: String(classroomId),
          metadata: {
            schoolId: classroom.school_id,
            exportScope: dto.exportScope,
            format: dto.format,
            columns: dto.columns,
            dateFrom: dto.dateFrom ?? null,
            dateTo: dto.dateTo ?? null,
          },
          ip: null,
        },
        queryRunner,
      );
    });
    return { data: { authorized: true } };
  }

  async listClassroomOptions(
    query: ListSchoolClassroomOptionsDto,
    actor: AuthenticatedRequestUser,
  ) {
    await this.assertSchoolAccess(query.schoolId, actor, true);
    const rows = await this.repository.listClassroomOptions(
      query.schoolId,
      query.termId,
      query.gradeLevelId,
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        gradeLevelId: row.grade_level_id,
        gradeLabel: row.grade_label,
        roomCode: row.room_code,
        roomName: row.room_name,
      })),
    };
  }

  async getClassroom(classroomId: number, actor: AuthenticatedRequestUser) {
    const classroom = await this.repository.findClassroomById(
      classroomId,
      undefined,
      resolveAuditActorId(actor),
    );
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor, true);
    return { data: this.toClassroom(classroom) };
  }

  async createClassroom(dto: CreateSchoolClassroomDto, actor: AuthenticatedRequestUser) {
    this.resolveScope(actor);
    const actorId = resolveAuditActorId(actor);
    const roomCode = dto.roomCode.trim();
    const roomNumber = roomNumberFromCode(roomCode);
    try {
      const row = await this.repository.withTransaction(async (queryRunner) => {
        const schoolId = await this.repository.findTermSchoolId(dto.schoolTermId, queryRunner);
        if (!schoolId) throw new NotFoundException('ไม่พบภาคเรียน');
        await this.assertSchoolAccess(schoolId, actor);
        const created = await this.repository.createClassroom(
          {
            schoolTermId: dto.schoolTermId,
            schoolId,
            gradeLevelId: dto.gradeLevelId,
            roomCode,
            roomNumber,
            roomName: dto.roomName?.trim() || null,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'school_classrooms',
            targetId: created.id,
            metadata: {
              op: 'create',
              schoolId,
              changedFields: ['schoolTermId', 'gradeLevelId', 'roomCode', 'roomName'],
            },
            ip: null,
          },
          queryRunner,
        );
        return created;
      });
      return { data: this.toClassroom(row) };
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('รหัสห้องนี้มีอยู่แล้วในภาคเรียนและระดับชั้นเดียวกัน');
      }
      if (databaseErrorCode(error) === '23503') {
        throw new BadRequestException('ภาคเรียนหรือระดับชั้นไม่ถูกต้อง');
      }
      throw error;
    }
  }

  async updateClassroom(
    classroomId: number,
    dto: UpdateSchoolClassroomDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('ไม่มีข้อมูลที่ต้องแก้ไข');
    const actorId = resolveAuditActorId(actor);
    const roomCode = dto.roomCode?.trim();
    try {
      const row = await this.repository.withTransaction(async (queryRunner) => {
        const existing = await this.repository.findClassroomById(classroomId, queryRunner);
        if (!existing) throw new NotFoundException('ไม่พบห้องเรียน');
        await this.assertSchoolAccess(existing.school_id, actor);
        const roomNumber = roomCode === undefined ? undefined : roomNumberFromCode(roomCode);
        if (dto.gradeLevelId !== undefined && dto.gradeLevelId !== existing.grade_level_id) {
          const usage = await this.repository.getClassroomUsage(classroomId, queryRunner);
          if (usage.studentCount > 0) {
            throw new ConflictException(
              'ห้องนี้มีนักเรียนอยู่แล้ว จึงเปลี่ยนระดับชั้นไม่ได้ — ย้ายนักเรียนออกก่อน',
            );
          }
        }
        const updated = await this.repository.updateClassroom(
          classroomId,
          {
            gradeLevelId: dto.gradeLevelId,
            roomCode,
            roomNumber,
            roomName: dto.roomName === undefined ? undefined : dto.roomName.trim() || null,
            classroomStatus: dto.classroomStatus,
          },
          actorId,
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'school_classrooms',
            targetId: String(classroomId),
            metadata: {
              op: 'update',
              schoolId: existing.school_id,
              changedFields: Object.keys(dto),
            },
            ip: null,
          },
          queryRunner,
        );
        return updated;
      });
      return { data: this.toClassroom(row) };
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('รหัสห้องนี้มีอยู่แล้วในภาคเรียนและระดับชั้นเดียวกัน');
      }
      if (databaseErrorCode(error) === '23503') {
        throw new BadRequestException('ระดับชั้นไม่ถูกต้อง');
      }
      throw error;
    }
  }

  /** Remove a mis-created classroom — only while nothing references it yet. */
  async deleteClassroom(classroomId: number, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findClassroomById(classroomId, queryRunner);
      if (!existing) throw new NotFoundException('ไม่พบห้องเรียน');
      await this.assertSchoolAccess(existing.school_id, actor);
      const usage = await this.repository.getClassroomUsage(classroomId, queryRunner);
      if (usage.studentCount > 0) {
        throw new ConflictException('ห้องนี้มีนักเรียนอยู่ จึงลบไม่ได้ — ย้ายนักเรียนออกก่อน');
      }
      if (usage.assignmentCount > 0) {
        throw new ConflictException('ห้องนี้มีครูผูกอยู่ จึงลบไม่ได้ — ยกเลิกการมอบหมายครูก่อน');
      }
      await this.repository.softDeleteClassroom(classroomId, actorId, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'school_classrooms',
          targetId: String(classroomId),
          metadata: { op: 'delete', schoolId: existing.school_id },
          ip: null,
        },
        queryRunner,
      );
    });
    return { data: { deleted: true } };
  }

  async listTeachers(query: ListSchoolTeachersDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor, true);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount, activeCount } = await this.repository.listTeachers({
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      classroomId: query.classroomId,
      assignedToFilteredClassrooms: query.assignedToFilteredClassrooms,
      sortBy: query.sortBy ?? 'name',
      sortDirection: query.sortDirection ?? 'asc',
      page,
      limit,
    });
    return {
      data: rows.map((row) => this.toTeacher(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
      summary: { activeCount },
    };
  }

  async listTeacherCandidates(
    query: ListSchoolTeacherCandidatesDto,
    actor: AuthenticatedRequestUser,
  ) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const rows = await this.repository.listTeacherCandidates(query.schoolId, query.searchTerm);
    return {
      data: rows.map((row) => ({ id: row.id, displayName: row.display_name })),
    };
  }

  async listTeacherOptions(query: ListSchoolTeacherCandidatesDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor, true);
    const rows = await this.repository.listTeacherOptions(query.schoolId, query.searchTerm);
    return { data: rows.map((row) => this.toTeacher(row)) };
  }

  async createTeacherMembership(
    dto: CreateSchoolTeacherMembershipDto,
    actor: AuthenticatedRequestUser,
  ) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    const actorId = resolveAuditActorId(actor);
    try {
      const row = await this.repository.withTransaction(async (queryRunner) => {
        if (!(await this.repository.isTeacherEligible(dto.teacherId, dto.schoolId, queryRunner))) {
          throw new BadRequestException('ครูคนนี้ใช้งานไม่ได้ หรือสังกัดโรงเรียนนี้อยู่แล้ว');
        }
        const created = await this.repository.createTeacherMembership(
          {
            schoolId: dto.schoolId,
            teacherId: dto.teacherId,
            startedOn: dto.startedOn ?? null,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'school_teacher_memberships',
            targetId: created.id,
            metadata: {
              op: 'create',
              schoolId: dto.schoolId,
              changedFields: ['teacherId', 'startedOn'],
            },
            ip: null,
          },
          queryRunner,
        );
        return created;
      });
      return { data: this.toTeacher(row) };
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('ครูคนนี้อยู่ในรายชื่อครูของโรงเรียนแล้ว');
      }
      throw error;
    }
  }

  async updateTeacherMembership(
    membershipId: number,
    dto: UpdateSchoolTeacherMembershipDto,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    const row = await this.repository.withTransaction(async (queryRunner) => {
      await this.repository.lockHomeroomClassroomsForMembership(membershipId, queryRunner);
      const existing = await this.repository.findMembershipById(membershipId, queryRunner);
      if (!existing) throw new NotFoundException('ไม่พบครูในโรงเรียน');
      await this.assertSchoolAccess(existing.school_id, actor);
      const updated = await this.repository.updateTeacherMembership(
        membershipId,
        dto.membershipStatus,
        dto.membershipStatus === 'INACTIVE' ? (dto.endedOn ?? null) : null,
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'school_teacher_memberships',
          targetId: String(membershipId),
          metadata: {
            op: 'update',
            schoolId: existing.school_id,
            changedFields: ['membershipStatus', 'endedOn'],
          },
          ip: null,
        },
        queryRunner,
      );
      return updated;
    });
    return { data: this.toTeacher(row) };
  }

  async listAssignments(classroomId: number, actor: AuthenticatedRequestUser) {
    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor);
    const rows = await this.repository.listAssignments(classroomId);
    return { data: rows.map((row) => this.toAssignment(row)) };
  }

  async setHomeroomTeachers(
    classroomId: number,
    dto: SetClassroomHomeroomTeachersDto,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    try {
      const rows = await this.repository.withTransaction(async (queryRunner) => {
        const classroom = await this.repository.findClassroomById(classroomId, queryRunner);
        if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
        await this.assertSchoolAccess(classroom.school_id, actor);

        const memberships = await this.repository.findMembershipsByIds(
          dto.teacherMembershipIds,
          queryRunner,
        );
        if (memberships.length !== dto.teacherMembershipIds.length) {
          throw new BadRequestException('ครูไม่ได้อยู่ในรายชื่อครูที่ใช้งานของโรงเรียน');
        }
        if (
          memberships.some(
            (membership) =>
              membership.membership_status !== 'ACTIVE' ||
              membership.school_id !== classroom.school_id,
          )
        ) {
          throw new BadRequestException('ครูและห้องเรียนต้องอยู่โรงเรียนเดียวกันและใช้งานอยู่');
        }

        await this.repository.replaceHomeroomTeachers(
          {
            schoolId: classroom.school_id,
            classroomId,
            teacherMembershipIds: dto.teacherMembershipIds,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'classroom_homeroom_teachers',
            targetId: String(classroomId),
            metadata: {
              op: 'replace',
              schoolId: classroom.school_id,
              classroomId,
              teacherCount: dto.teacherMembershipIds.length,
              changedFields: ['teacherMembershipIds'],
            },
            ip: null,
          },
          queryRunner,
        );
        return this.repository.listAssignments(classroomId, queryRunner);
      });
      return { data: rows.map((row) => this.toAssignment(row)) };
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('ครูประจำชั้นซ้ำกัน');
      }
      if (databaseErrorCode(error) === '23503') {
        throw new BadRequestException('ห้องหรือครูไม่ถูกต้อง');
      }
      throw error;
    }
  }

  async createAssignment(
    dto: CreateClassroomTeacherAssignmentDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (
      dto.effectiveOn &&
      dto.effectiveUntil &&
      Date.parse(dto.effectiveOn) > Date.parse(dto.effectiveUntil)
    ) {
      throw new BadRequestException('ช่วงวันที่มอบหมายไม่ถูกต้อง');
    }
    const actorId = resolveAuditActorId(actor);
    try {
      const row = await this.repository.withTransaction(async (queryRunner) => {
        const classroom = await this.repository.findClassroomById(dto.classroomId, queryRunner);
        if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
        await this.assertSchoolAccess(classroom.school_id, actor);
        const membership = await this.repository.findMembershipById(
          dto.teacherMembershipId,
          queryRunner,
        );
        if (!membership || membership.membership_status !== 'ACTIVE') {
          throw new BadRequestException('ครูไม่ได้อยู่ในรายชื่อครูที่ใช้งานของโรงเรียน');
        }
        if (membership.school_id !== classroom.school_id) {
          throw new BadRequestException('ครูและห้องเรียนต้องอยู่โรงเรียนเดียวกัน');
        }
        if (dto.assignmentKind !== 'HOMEROOM') {
          throw new BadRequestException('การมอบหมายรายวิชาใช้หน้ารายวิชาในระดับชั้น');
        }
        const created = await this.repository.createAssignment(
          {
            schoolId: classroom.school_id,
            classroomId: dto.classroomId,
            teacherMembershipId: dto.teacherMembershipId,
            subjectId: null,
            assignmentKind: 'HOMEROOM',
            effectiveOn: dto.effectiveOn ?? null,
            effectiveUntil: dto.effectiveUntil ?? null,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'classroom_homeroom_teachers',
            targetId: created.id,
            metadata: {
              op: 'create',
              schoolId: classroom.school_id,
              classroomId: dto.classroomId,
              changedFields: ['teacherMembershipId', 'assignmentKind', 'subjectId'],
            },
            ip: null,
          },
          queryRunner,
        );
        return created;
      });
      return { data: this.toAssignment(row) };
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('มีการมอบหมายครูรายการนี้อยู่แล้ว');
      }
      if (databaseErrorCode(error) === '23503') {
        throw new BadRequestException('ห้อง ครู หรือรายวิชาไม่ถูกต้อง');
      }
      throw error;
    }
  }

  async listRoster(query: ListClassroomRosterDto, actor: AuthenticatedRequestUser) {
    if (!query.schoolId && !query.classroomId) {
      throw new BadRequestException('กรุณาเลือกโรงเรียนหรือห้องเรียน');
    }
    if (query.schoolId) {
      await this.assertSchoolAccess(query.schoolId, actor);
    } else {
      const classroom = await this.repository.findClassroomById(query.classroomId!);
      if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
      await this.assertSchoolAccess(classroom.school_id, actor);
    }
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listRoster({
      search: query.search,
      riskTier: query.riskTier,
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      classroomId: query.classroomId,
      sortBy: query.sortBy ?? 'name',
      sortDirection: query.sortDirection ?? 'asc',
      page,
      limit,
    });
    return {
      data: rows.map((row) => ({
        studentUuid: row.student_uuid,
        studentNumber: row.student_number,
        photoUrl: row.photo_storage_key
          ? `/api/students/${encodeURIComponent(row.student_uuid)}/photo?v=${encodeMediaVersion(row.photo_updated_at)}`
          : null,
        riskTier: row.risk_tier ?? 'NORMAL',
        riskSeverity: row.risk_severity ?? 0,
        teacherComment: row.teacher_comment,
        firstName: row.first_name,
        lastName: row.last_name,
        studentStatusCode: row.student_status_code,
        studentStatusLabel: row.student_status_label,
        studentStatusBadgeVariant: row.student_status_badge_variant,
        classroomId: row.classroom_id,
        gradeLabel: row.grade_label,
        roomCode: row.room_code,
      })),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async createStudentComment(
    classroomId: number,
    studentUuid: string,
    dto: CreateClassroomStudentCommentDto,
    actor: AuthenticatedRequestUser,
  ) {
    this.resolveCommentScope(actor);
    const actorId = resolveAuditActorId(actor);
    if (!actorId) throw new ForbiddenException('บัญชีนี้ไม่รองรับการบันทึกความคิดเห็น');

    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertClassroomCommentAccess(classroom, actor);

    const created = await this.repository.withTransaction(async (queryRunner) => {
      const comment = await this.repository.createStudentComment(
        classroomId,
        studentUuid,
        dto.problemCategory,
        dto.concernLevelCode,
        dto.problemDescription,
        actorId,
        queryRunner,
      );
      if (!comment) throw new NotFoundException('ไม่พบนักเรียนในห้องเรียนนี้');

      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'classroom_student_comments',
          targetId: comment.id,
          metadata: {
            op: 'create',
            schoolId: classroom.school_id,
            classroomId,
            studentUuid,
            problemCategory: dto.problemCategory,
            concernLevelCode: dto.concernLevelCode,
            descriptionLength: dto.problemDescription.length,
          },
          ip: null,
        },
        queryRunner,
      );
      return comment;
    });

    if (dto.concernLevelCode !== 'NOTE') {
      await this.riskProfileService
        .requestStudentRecalculation([studentUuid], 'classroom-comment')
        .catch(() => {
          this.logger.warn('Unable to refresh risk profile after classroom comment');
        });
    }

    return {
      data: {
        id: created.id,
        studentUuid,
        problemCategory: created.problem_category_code as ClassroomStudentProblemCategory,
        problemCategoryLabel: created.problem_category_label,
        problemCategoryGuidance: created.problem_category_guidance,
        concernLevelCode: created.concern_level_code,
        concernLevelLabel: created.concern_level_label,
        problemDescription: created.problem_description,
        createdAt: created.created_at,
      },
    };
  }

  async listClassroomAttendanceHistory(
    classroomId: number,
    query: ListClassroomAttendanceHistoryDto,
    actor: AuthenticatedRequestUser,
  ) {
    this.resolveScope(actor);
    const classroom = await this.repository.findClassroomById(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    await this.assertSchoolAccess(classroom.school_id, actor);

    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new BadRequestException('วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด');
    }
    if (query.studentUuid) {
      const sortBy =
        query.sortBy === 'time' ||
        query.sortBy === 'recordedBy' ||
        query.sortBy === 'status' ||
        query.sortBy === 'date'
          ? query.sortBy
          : 'date';
      const result = await this.repository.listStudentAttendanceDays({
        classroomId,
        studentUuid: query.studentUuid,
        date: query.date,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        search: query.search,
        sortBy,
        sortDirection: query.sortDirection ?? 'desc',
        page,
        limit,
      });
      return {
        data: result.rows.map((row) => ({
          id: row.attendance_id,
          date: row.attendance_date,
          time: row.recorded_time,
          recordedBy: row.recorded_by,
          status: attendanceStatusFromCode(row.attendance_status),
        })),
        meta: buildPaginationMeta(page, limit, result.totalCount),
      };
    }

    if (query.view === 'DAILY') {
      const sortBy =
        query.sortBy === 'recordedBy' ||
        query.sortBy === 'present' ||
        query.sortBy === 'late' ||
        query.sortBy === 'leave' ||
        query.sortBy === 'absent' ||
        query.sortBy === 'date'
          ? query.sortBy
          : 'date';
      const result = await this.repository.listClassroomDailyAttendance({
        classroomId,
        subjectId: query.subjectId ?? null,
        date: query.date,
        search: query.search,
        sortBy,
        sortDirection: query.sortDirection ?? 'desc',
        page,
        limit,
      });
      return {
        data: result.rows.map((row) => ({
          date: row.attendance_date,
          recordedBy: row.recorded_by,
          presentCount: row.present_count,
          lateCount: row.late_count,
          leaveCount: row.leave_count,
          absentCount: row.absent_count,
        })),
        meta: buildPaginationMeta(page, limit, result.totalCount),
      };
    }

    const sortBy =
      query.sortBy === 'studentNumber' ||
      query.sortBy === 'status' ||
      query.sortBy === 'present' ||
      query.sortBy === 'late' ||
      query.sortBy === 'leave' ||
      query.sortBy === 'absent' ||
      query.sortBy === 'name'
        ? query.sortBy
        : 'name';
    const result = await this.repository.listClassroomStudentAttendance({
      classroomId,
      subjectId: query.subjectId ?? null,
      date: query.date,
      search: query.search,
      sortBy,
      sortDirection: query.sortDirection ?? 'asc',
      page,
      limit,
    });
    return {
      data: result.rows.map((row) => ({
        studentUuid: row.student_uuid,
        studentNumber: row.student_number,
        photoUrl: row.photo_storage_key
          ? `/api/students/${encodeURIComponent(row.student_uuid)}/photo?v=${encodeMediaVersion(row.photo_updated_at)}`
          : null,
        firstName: row.first_name,
        lastName: row.last_name,
        presentCount: row.present_count,
        lateCount: row.late_count,
        leaveCount: row.leave_count,
        absentCount: row.absent_count,
      })),
      meta: buildPaginationMeta(page, limit, result.totalCount),
    };
  }

  async listStudentProblemCategories() {
    return { data: await this.repository.listStudentProblemCategories() };
  }

  async listStudentCommentConcernLevels() {
    return { data: await this.repository.listStudentCommentConcernLevels() };
  }
}
