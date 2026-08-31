import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  AddSchoolSubjectDto,
  ListGradeSchoolSubjectsQueryDto,
  ListSchoolSubjectsQueryDto,
  ListSubjectGradesQueryDto,
  ReplaceClassroomSubjectsDto,
  SaveClassroomSubjectTeachersDto,
  SaveGradeSchoolSubjectDto,
  UpdateSchoolSubjectDto,
} from './dto/subjects.dto';
import { SchoolStructureRepository } from '../school-structure/school-structure.repository';
import { SubjectsRepository } from './subjects.repository';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class SubjectsService {
  constructor(
    private readonly repository: SubjectsRepository,
    private readonly auditLog: AuditLogService,
    private readonly schoolStructureRepository: SchoolStructureRepository,
  ) {}

  private resolveSchoolScope(actor: AuthenticatedRequestUser): DataScope {
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (scope.own_only === true || isUnconfiguredDataScope(scope)) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการรายวิชา');
    }
    if (scope.global !== true && !hasAreaDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตโรงเรียนที่ใช้งานได้');
    }
    return scope;
  }

  private async assertSchoolAccess(
    actor: AuthenticatedRequestUser,
    schoolId: number,
  ): Promise<DataScope> {
    const scope = this.resolveSchoolScope(actor);
    if (!(await this.schoolStructureRepository.isSchoolInScope(schoolId, scope))) {
      throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    }
    return scope;
  }

  private toSchoolSubjectResponse(row: import('./subjects.types').SchoolSubjectRow) {
    return {
      id: Number(row.id),
      schoolId: row.school_id,
      subjectId: row.subject_id,
      code: row.code,
      nameTh: row.name_th,
      status: row.subject_status,
      classroomCount: Number(row.classroom_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toClassroomSubjectResponse(row: import('./subjects.types').ClassroomSubjectRow) {
    return {
      id: Number(row.id),
      schoolId: row.school_id,
      classroomId: Number(row.classroom_id),
      schoolSubjectId: Number(row.school_subject_id),
      subjectId: row.subject_id,
      code: row.code,
      nameTh: row.name_th,
      status: row.offering_status,
    };
  }

  private toGradeSchoolSubjectResponse(
    row: import('./subjects.types').GradeSchoolSubjectRow,
    classrooms: import('./subjects.types').GradeSubjectClassroomRow[],
  ) {
    return {
      id: Number(row.id),
      schoolId: row.school_id,
      gradeLevelId: row.grade_level_id,
      gradeLabel: row.grade_label,
      subjectId: row.subject_id,
      subjectCode: row.code,
      subjectName: row.name_th,
      status: row.subject_status,
      classrooms: classrooms.map((classroom) => ({
        id: Number(classroom.classroom_id),
        classroomSubjectId: Number(classroom.classroom_subject_id),
        label: classroom.classroom_label,
        teachers: (classroom.teachers ?? []).map((teacher) => ({
          membershipId: Number(teacher.membershipId),
          teacherId: teacher.teacherId,
          name: teacher.name,
          // Served through the app like every other photo, so the guard runs
          // before the bytes and private storage stays private.
          photoUrl: teacher.photoUpdatedAt
            ? `/api/teacher-profiles/${teacher.teacherId}/photo?v=${encodeURIComponent(
                new Date(teacher.photoUpdatedAt).toISOString(),
              )}`
            : null,
        })),
      })),
    };
  }

  async listSchoolCatalog(actor: AuthenticatedRequestUser, query: ListSchoolSubjectsQueryDto) {
    await this.assertSchoolAccess(actor, query.schoolId);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listSchoolCatalog({
      schoolId: query.schoolId,
      page,
      limit,
      searchTerm: query.searchTerm?.trim() || undefined,
      status: query.status,
    });
    return {
      success: true,
      data: rows.map((row) => this.toSchoolSubjectResponse(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async listSubjectGrades(actor: AuthenticatedRequestUser, query: ListSubjectGradesQueryDto) {
    await this.assertSchoolAccess(actor, query.schoolId);
    const rows = await this.repository.listSubjectGrades({
      schoolId: query.schoolId,
      termId: query.termId,
      searchTerm: query.searchTerm?.trim() || undefined,
    });
    return {
      success: true,
      data: rows.map((row) => ({
        gradeLevelId: row.grade_level_id,
        gradeLabel: row.grade_label,
        gradeCategory: row.grade_category,
        subjectCount: Number(row.subject_count),
      })),
    };
  }

  async listGradeSchoolSubjects(
    actor: AuthenticatedRequestUser,
    query: ListGradeSchoolSubjectsQueryDto,
  ) {
    await this.assertSchoolAccess(actor, query.schoolId);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listGradeSchoolSubjects({
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      page,
      limit,
      searchTerm: query.searchTerm?.trim() || undefined,
    });
    const classroomRows = await this.repository.listGradeSubjectClassrooms({
      schoolSubjectIds: rows.map((row) => Number(row.id)),
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
    });
    return {
      success: true,
      data: rows.map((row) =>
        this.toGradeSchoolSubjectResponse(
          row,
          classroomRows.filter((item) => item.school_subject_id === row.id),
        ),
      ),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async getGradeSchoolSubject(
    actor: AuthenticatedRequestUser,
    schoolSubjectId: number,
    query: ListGradeSchoolSubjectsQueryDto,
  ) {
    await this.assertSchoolAccess(actor, query.schoolId);
    const { rows } = await this.repository.listGradeSchoolSubjects({
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      schoolSubjectId,
      page: 1,
      limit: 1,
    });
    const row = rows[0];
    if (!row) throw new NotFoundException('ไม่พบรายวิชาในระดับชั้นนี้');
    const classrooms = await this.repository.listGradeSubjectClassrooms({
      schoolSubjectIds: [schoolSubjectId],
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
    });
    return { success: true, data: this.toGradeSchoolSubjectResponse(row, classrooms) };
  }

  async saveClassroomSubjectTeachers(
    actor: AuthenticatedRequestUser,
    payload: SaveClassroomSubjectTeachersDto,
  ) {
    const scope = await this.assertSchoolAccess(actor, payload.schoolId);
    const actorId = resolveAuditActorId(actor);
    const updated = await this.repository.withTransaction(async (queryRunner) => {
      // Lock and validate the same rows that will be rewritten. This prevents a
      // membership or offering from becoming inactive between validation and
      // the replacement write.
      const offerings = await this.repository.findClassroomSubjectsForTeacherUpdate(
        {
          classroomSubjectIds: payload.classroomSubjectIds,
          schoolId: payload.schoolId,
        },
        queryRunner,
      );
      if (offerings.length !== payload.classroomSubjectIds.length) {
        throw new NotFoundException('ไม่พบรายวิชาของห้องเรียนที่เลือกในโรงเรียนนี้');
      }
      if (
        offerings.some(
          (offering) =>
            !isClassInScope(scope, {
              gradeLevelId: offering.grade_level_id,
              roomId: offering.legacy_room_number,
            }),
        )
      ) {
        throw new NotFoundException('มีห้องเรียนที่อยู่นอกขอบเขตของคุณ');
      }
      const teacherMembershipIds = await this.repository.filterSchoolTeacherMemberships(
        {
          membershipIds: payload.teacherMembershipIds,
          schoolId: payload.schoolId,
        },
        queryRunner,
      );
      if (teacherMembershipIds.length !== payload.teacherMembershipIds.length) {
        throw new BadRequestException('มีครูที่ไม่ได้เปิดใช้งานในโรงเรียนนี้');
      }
      await this.repository.replaceClassroomSubjectTeachers(
        {
          classroomSubjects: offerings.map((offering) => ({
            id: Number(offering.id),
            classroomId: Number(offering.classroom_id),
          })),
          schoolId: payload.schoolId,
          teacherMembershipIds,
          actorId,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_SUBJECTS_REPLACE',
          targetType: 'classroom_subject_teachers',
          targetId: String(payload.schoolId),
          metadata: {
            schoolId: payload.schoolId,
            classroomSubjectIds: payload.classroomSubjectIds,
            classroomIds: [...new Set(offerings.map((item) => Number(item.classroom_id)))],
            teacherMembershipIds,
            changedFields: ['teacherMembershipIds'],
          },
          ip: null,
        },
        queryRunner,
      );
      return offerings.length;
    });
    return { success: true, data: { updated } };
  }

  async saveGradeSchoolSubject(
    actor: AuthenticatedRequestUser,
    schoolSubjectId: number | null,
    dto: SaveGradeSchoolSubjectDto,
  ) {
    await this.assertSchoolAccess(actor, dto.schoolId);
    const actorId = resolveAuditActorId(actor);
    let savedId = schoolSubjectId;
    try {
      await this.repository.withTransaction(async (queryRunner) => {
        const validClassrooms = await this.repository.assertGradeClassrooms(
          {
            classroomIds: dto.classroomIds,
            schoolId: dto.schoolId,
            termId: dto.termId,
            gradeLevelId: dto.gradeLevelId,
          },
          queryRunner,
        );
        if (!validClassrooms) {
          throw new BadRequestException('มีห้องเรียนที่ไม่อยู่ในโรงเรียน ภาคเรียน หรือชั้นนี้');
        }

        if (schoolSubjectId) {
          const existing = await this.repository.findSchoolSubjectById(
            schoolSubjectId,
            queryRunner,
          );
          if (!existing || existing.school_id !== dto.schoolId) {
            throw new NotFoundException('ไม่พบรายวิชาของโรงเรียน');
          }
          if (existing.code !== dto.code) {
            throw new BadRequestException('ไม่สามารถเปลี่ยนรหัสวิชาหลังสร้างแล้ว');
          }
          if (existing.name_th !== dto.nameTh) {
            const shared = await this.repository.isSubjectSharedWithAnotherSchool(
              existing.subject_id,
              dto.schoolId,
              queryRunner,
            );
            if (shared) {
              throw new ConflictException(
                'รหัสวิชานี้ใช้ร่วมกับโรงเรียนอื่น จึงเปลี่ยนชื่อจากโรงเรียนเดียวไม่ได้',
              );
            }
            await this.repository.updateSubjectName(
              existing.subject_id,
              dto.nameTh,
              actorId,
              queryRunner,
            );
          }
        } else {
          const created = await this.repository.createSchoolSubject(
            {
              schoolId: dto.schoolId,
              code: dto.code,
              nameTh: dto.nameTh,
              actorId,
            },
            queryRunner,
          );
          if (!created) throw new ConflictException('รหัสวิชานี้มีชื่อวิชาอื่นอยู่แล้ว');
          savedId = Number(created.id);
        }

        await this.repository.replaceGradeSubjectClassrooms(
          {
            schoolSubjectId: savedId!,
            schoolId: dto.schoolId,
            termId: dto.termId,
            gradeLevelId: dto.gradeLevelId,
            classroomIds: dto.classroomIds,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'CLASSROOM_SUBJECTS_REPLACE',
            targetType: 'school_subject',
            targetId: String(savedId),
            metadata: {
              schoolId: dto.schoolId,
              termId: dto.termId,
              gradeLevelId: dto.gradeLevelId,
              classroomCount: dto.classroomIds.length,
            },
            ip: null,
          },
          queryRunner,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('รายวิชานี้มีอยู่แล้ว');
      throw error;
    }
    return await this.getGradeSchoolSubject(actor, savedId!, {
      schoolId: dto.schoolId,
      termId: dto.termId,
      gradeLevelId: dto.gradeLevelId,
      page: 1,
      limit: 1,
    });
  }

  async removeGradeSchoolSubject(
    actor: AuthenticatedRequestUser,
    schoolSubjectId: number,
    query: ListGradeSchoolSubjectsQueryDto,
  ) {
    await this.assertSchoolAccess(actor, query.schoolId);
    const actorId = resolveAuditActorId(actor);
    await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findSchoolSubjectById(schoolSubjectId, queryRunner);
      if (!existing || existing.school_id !== query.schoolId) {
        throw new NotFoundException('ไม่พบรายวิชาของโรงเรียน');
      }
      await this.repository.removeGradeSubjectClassrooms(
        {
          schoolSubjectId,
          schoolId: query.schoolId,
          termId: query.termId,
          gradeLevelId: query.gradeLevelId,
          actorId,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_SUBJECTS_REPLACE',
          targetType: 'school_subject',
          targetId: String(schoolSubjectId),
          metadata: {
            schoolId: query.schoolId,
            termId: query.termId,
            gradeLevelId: query.gradeLevelId,
          },
          ip: null,
        },
        queryRunner,
      );
    });
    return { success: true };
  }

  async addSchoolSubject(actor: AuthenticatedRequestUser, dto: AddSchoolSubjectDto) {
    await this.assertSchoolAccess(actor, dto.schoolId);
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (queryRunner) => {
        const created = await this.repository.createSchoolSubject(
          {
            schoolId: dto.schoolId,
            code: dto.code,
            nameTh: dto.nameTh,
            actorId,
          },
          queryRunner,
        );
        if (!created) {
          throw new ConflictException('รหัสวิชานี้มีชื่อวิชาอื่นอยู่แล้ว');
        }
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'SCHOOL_SUBJECT_UPSERT',
            targetType: 'school_subject',
            targetId: created.id,
            metadata: { schoolId: created.school_id, code: created.code },
            ip: null,
          },
          queryRunner,
        );
        return { success: true, data: this.toSchoolSubjectResponse(created) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รหัสวิชานี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async updateSchoolSubject(
    actor: AuthenticatedRequestUser,
    schoolSubjectId: number,
    dto: UpdateSchoolSubjectDto,
  ) {
    const actorId = resolveAuditActorId(actor);
    return await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findSchoolSubjectById(schoolSubjectId, queryRunner);
      if (!existing) throw new NotFoundException('ไม่พบรายวิชาของโรงเรียน');
      await this.assertSchoolAccess(actor, existing.school_id);
      const updated = await this.repository.updateSchoolSubjectStatus(
        schoolSubjectId,
        dto.status,
        actorId,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'SCHOOL_SUBJECT_STATUS_UPDATE',
          targetType: 'school_subject',
          targetId: updated.id,
          metadata: { schoolId: updated.school_id, status: updated.subject_status },
          ip: null,
        },
        queryRunner,
      );
      return { success: true, data: this.toSchoolSubjectResponse(updated) };
    });
  }

  async listClassroomOfferings(actor: AuthenticatedRequestUser, classroomId: number) {
    const classroom = await this.repository.findClassroomScope(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    const scope = await this.assertSchoolAccess(actor, classroom.school_id);
    if (!isClassInScope(scope, { gradeLevelId: classroom.grade_level_id, roomId: classroom.id })) {
      throw new NotFoundException('ไม่พบห้องเรียนในขอบเขตของคุณ');
    }
    const rows = await this.repository.listClassroomOfferings(classroomId);
    return { success: true, data: rows.map((row) => this.toClassroomSubjectResponse(row)) };
  }

  async replaceClassroomOfferings(
    actor: AuthenticatedRequestUser,
    classroomId: number,
    dto: ReplaceClassroomSubjectsDto,
  ) {
    const classroom = await this.repository.findClassroomScope(classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    const scope = await this.assertSchoolAccess(actor, classroom.school_id);
    if (!isClassInScope(scope, { gradeLevelId: classroom.grade_level_id, roomId: classroom.id })) {
      throw new NotFoundException('ไม่พบห้องเรียนในขอบเขตของคุณ');
    }
    const actorId = resolveAuditActorId(actor);
    await this.repository.withTransaction(async (queryRunner) => {
      const validCount = await this.repository.countActiveSchoolSubjects(
        classroom.school_id,
        dto.schoolSubjectIds,
        queryRunner,
      );
      if (validCount !== dto.schoolSubjectIds.length) {
        throw new BadRequestException('มีรายวิชาที่ไม่ได้เปิดใช้ในโรงเรียนนี้');
      }
      await this.repository.replaceClassroomOfferings(
        {
          classroomId,
          schoolId: classroom.school_id,
          schoolSubjectIds: dto.schoolSubjectIds,
          actorId,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_SUBJECTS_REPLACE',
          targetType: 'school_classroom',
          targetId: String(classroomId),
          metadata: {
            schoolId: classroom.school_id,
            selectedSubjectCount: dto.schoolSubjectIds.length,
          },
          ip: null,
        },
        queryRunner,
      );
    });
    return await this.listClassroomOfferings(actor, classroomId);
  }
}
