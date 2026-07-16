import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  hasAreaDataScope,
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { hasPermission } from '../auth/permissions.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  CreateClassroomTeacherAssignmentDto,
  CreateSchoolClassroomDto,
  CreateSchoolTeacherMembershipDto,
  ListClassroomRosterDto,
  ListSchoolClassroomOptionsDto,
  ListSchoolClassroomsDto,
  ListSchoolTeacherCandidatesDto,
  ListSchoolTeachersDto,
  UpdateSchoolClassroomDto,
  UpdateSchoolTeacherMembershipDto,
} from './dto/school-structure.dto';
import { SchoolStructureRepository } from './school-structure.repository';
import type {
  ClassroomTeacherAssignmentRow,
  SchoolClassroomRow,
  SchoolTeacherMembershipRow,
} from './school-structure.types';

function databaseErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
}

@Injectable()
export class SchoolStructureService {
  constructor(
    private readonly repository: SchoolStructureRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private resolveScope(actor: AuthenticatedRequestUser, allowRelatedRead = false): DataScope {
    const canManageStructure = hasPermission(
      actor.roles,
      actor.permissions,
      'manage-school-structure',
    );
    const canUseRelatedRead =
      allowRelatedRead &&
      ['manage-teacher-access', 'import-data', 'import-school-roster'].some((permission) =>
        hasPermission(actor.roles, actor.permissions, permission),
      );
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
      studentCount: Number(row.student_count),
    };
  }

  private toTeacher(row: SchoolTeacherMembershipRow) {
    return {
      id: row.id,
      schoolId: row.school_id,
      teacherUserId: row.teacher_user_id,
      username: row.username,
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
      teacherUserId: row.teacher_user_id,
      teacherName: row.teacher_name,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      assignmentKind: row.assignment_kind,
      assignmentStatus: row.assignment_status,
      effectiveOn: row.effective_on,
      effectiveUntil: row.effective_until,
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
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      classroomId: query.classroomId,
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

  async createClassroom(dto: CreateSchoolClassroomDto, actor: AuthenticatedRequestUser) {
    this.resolveScope(actor);
    const actorId = resolveAuditActorId(actor);
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
            legacyRoomNumber: dto.legacyRoomNumber ?? null,
            roomCode: dto.roomCode.trim(),
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
    const row = await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findClassroomById(classroomId, queryRunner);
      if (!existing) throw new NotFoundException('ไม่พบห้องเรียน');
      await this.assertSchoolAccess(existing.school_id, actor);
      const updated = await this.repository.updateClassroom(
        classroomId,
        dto.roomName === undefined ? undefined : dto.roomName.trim() || null,
        dto.classroomStatus,
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
          metadata: { op: 'update', schoolId: existing.school_id, changedFields: Object.keys(dto) },
          ip: null,
        },
        queryRunner,
      );
      return updated;
    });
    return { data: this.toClassroom(row) };
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
        if (
          !(await this.repository.isTeacherEligible(dto.teacherUserId, dto.schoolId, queryRunner))
        ) {
          throw new BadRequestException('ผู้ใช้นี้ไม่ใช่บัญชีที่มีสิทธิ์ปฏิบัติงานครู');
        }
        const created = await this.repository.createTeacherMembership(
          {
            schoolId: dto.schoolId,
            teacherUserId: dto.teacherUserId,
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
              changedFields: ['teacherUserId', 'startedOn'],
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
        const created = await this.repository.createAssignment(
          {
            schoolId: classroom.school_id,
            classroomId: dto.classroomId,
            teacherMembershipId: dto.teacherMembershipId,
            subjectId: dto.assignmentKind === 'SUBJECT' ? (dto.subjectId ?? null) : null,
            assignmentKind: dto.assignmentKind,
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
            targetType: 'classroom_teacher_assignments',
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
}
