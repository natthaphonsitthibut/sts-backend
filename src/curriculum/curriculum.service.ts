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
import {
  hasAreaDataScope,
  hasPermission,
  isUnconfiguredDataScope,
  normalizeDataScope,
} from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { processCurriculumPdf } from '../common/file-upload/visit-photo.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import { CurriculumRepository } from './curriculum.repository';
import type { CurriculumSubjectRow, CurriculumSubjectTeacherRow } from './curriculum.types';
import type {
  ListCurriculumGradesQueryDto,
  ListCurriculumSubjectsQueryDto,
  SaveCurriculumSubjectDto,
} from './dto/curriculum.dto';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';
}

@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);

  constructor(
    private readonly repository: CurriculumRepository,
    private readonly auditLog: AuditLogService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
  ) {}

  /**
   * Curriculum is school-wide setup, so the actor needs a scope that resolves to
   * whole schools — a grade- or room-limited account manages students, not what
   * the school teaches.
   */
  private resolveScope(actor: AuthenticatedRequestUser): DataScope {
    if (!hasPermission(actor.roles, actor.permissions, 'manage-curriculum')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการข้อมูลหลักสูตร');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการหลักสูตรระดับโรงเรียน');
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

  private toSubject(row: CurriculumSubjectRow, coverage: CurriculumSubjectTeacherRow[]) {
    // Group flat coverage rows back into the form's "one teacher, many rooms"
    // blocks, while keeping the flat list for the read-only table in the ref.
    const byTeacher = new Map<
      string,
      {
        teacherMembershipId: string;
        teacherName: string;
        classrooms: Array<{ id: string; label: string }>;
      }
    >();
    for (const item of coverage) {
      const existing = byTeacher.get(item.teacher_membership_id);
      const classroom = { id: item.classroom_id, label: item.classroom_label };
      if (existing) {
        existing.classrooms.push(classroom);
      } else {
        byTeacher.set(item.teacher_membership_id, {
          teacherMembershipId: item.teacher_membership_id,
          teacherName: item.teacher_name,
          classrooms: [classroom],
        });
      }
    }

    return {
      id: row.id,
      schoolId: row.school_id,
      schoolTermId: row.school_term_id,
      gradeLevelId: row.grade_level_id,
      gradeLabel: row.grade_label,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      contentFileName: row.content_file_name,
      contentFileSizeBytes: row.content_file_size_bytes,
      contentUrl: row.content_storage_key
        ? `/api/curriculum/subjects/${row.id}/content?v=${encodeURIComponent(
            row.content_storage_key,
          )}`
        : null,
      curriculumStatus: row.curriculum_status,
      teachers: [...byTeacher.values()],
      // Flat rows drive the ห้องเรียน / ครูผู้สอน table.
      coverage: coverage.map((item) => ({
        id: item.id,
        teacherMembershipId: item.teacher_membership_id,
        teacherName: item.teacher_name,
        classroomId: item.classroom_id,
        classroomLabel: item.classroom_label,
      })),
    };
  }

  async listGrades(query: ListCurriculumGradesQueryDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const rows = await this.repository.listGrades({
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

  async listSubjects(query: ListCurriculumSubjectsQueryDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.repository.listSubjects({
      schoolId: query.schoolId,
      termId: query.termId,
      gradeLevelId: query.gradeLevelId,
      searchTerm: query.searchTerm?.trim() || undefined,
      page,
      limit,
    });
    const coverage = await this.repository.listTeachersForSubjects(rows.map((row) => row.id));
    return {
      success: true,
      data: rows.map((row) =>
        this.toSubject(
          row,
          coverage.filter((item) => item.curriculum_subject_id === row.id),
        ),
      ),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async findSubject(curriculumSubjectId: string, actor: AuthenticatedRequestUser) {
    const row = await this.repository.findSubjectById(curriculumSubjectId);
    if (!row) throw new NotFoundException('ไม่พบรายวิชาในหลักสูตร');
    await this.assertSchoolAccess(row.school_id, actor);
    const coverage = await this.repository.listTeachersForSubjects([row.id]);
    return { success: true, data: this.toSubject(row, coverage) };
  }

  private flattenCoverage(dto: SaveCurriculumSubjectDto) {
    const seen = new Set<string>();
    const coverage: Array<{ teacherMembershipId: number; classroomId: number }> = [];
    for (const block of dto.teachers ?? []) {
      for (const classroomId of block.classroomIds) {
        const key = `${block.teacherMembershipId}:${classroomId}`;
        // The form can repeat a teacher across blocks; the unique index would
        // reject the duplicate, so collapse it here with a clear message instead.
        if (seen.has(key)) {
          throw new BadRequestException('มีครูและห้องเรียนซ้ำกันในรายวิชานี้');
        }
        seen.add(key);
        coverage.push({ teacherMembershipId: block.teacherMembershipId, classroomId });
      }
    }
    return coverage;
  }

  async createSubject(dto: SaveCurriculumSubjectDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(dto.schoolId, actor);
    const actorId = resolveAuditActorId(actor);
    const coverage = this.flattenCoverage(dto);
    try {
      const created = await this.repository.withTransaction(async (queryRunner) => {
        const subject = await this.repository.upsertSubject(
          { code: dto.subjectCode, nameTh: dto.subjectName, actorId },
          queryRunner,
        );
        const offering = await this.repository.createSubjectOffering(
          {
            schoolId: dto.schoolId,
            termId: dto.termId,
            gradeLevelId: dto.gradeLevelId,
            subjectId: subject.id,
            actorId,
          },
          queryRunner,
        );
        await this.repository.replaceTeacherCoverage(
          {
            curriculumSubjectId: offering.id,
            schoolId: dto.schoolId,
            termId: dto.termId,
            gradeLevelId: dto.gradeLevelId,
            coverage,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'curriculum_subjects',
            targetId: offering.id,
            metadata: {
              op: 'create',
              schoolId: dto.schoolId,
              schoolTermId: dto.termId,
              gradeLevelId: dto.gradeLevelId,
              subjectCode: dto.subjectCode,
              coverageCount: coverage.length,
            },
            ip: null,
          },
          queryRunner,
        );
        const row = await this.repository.findSubjectById(offering.id, queryRunner);
        if (!row) throw new NotFoundException('ไม่พบรายวิชาหลังบันทึก');
        return row;
      });
      return await this.findSubject(created.id, actor);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รายวิชานี้มีอยู่ในหลักสูตรของชั้นและภาคเรียนนี้แล้ว');
      }
      if (isForeignKeyViolation(error)) {
        throw new BadRequestException(
          'ครูหรือห้องเรียนที่เลือกไม่อยู่ในโรงเรียน ภาคเรียน หรือชั้นนี้',
        );
      }
      throw error;
    }
  }

  async updateSubject(
    curriculumSubjectId: string,
    dto: SaveCurriculumSubjectDto,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    const coverage = this.flattenCoverage(dto);
    try {
      await this.repository.withTransaction(async (queryRunner) => {
        const existing = await this.repository.findSubjectById(
          curriculumSubjectId,
          queryRunner,
          true,
        );
        if (!existing) throw new NotFoundException('ไม่พบรายวิชาในหลักสูตร');
        await this.assertSchoolAccess(existing.school_id, actor);

        const subject = await this.repository.upsertSubject(
          { code: dto.subjectCode, nameTh: dto.subjectName, actorId },
          queryRunner,
        );
        await this.repository.updateSubjectOffering(
          curriculumSubjectId,
          subject.id,
          actorId,
          queryRunner,
        );
        await this.repository.replaceTeacherCoverage(
          {
            curriculumSubjectId,
            schoolId: existing.school_id,
            termId: Number(existing.school_term_id),
            gradeLevelId: existing.grade_level_id,
            coverage,
            actorId,
          },
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'curriculum_subjects',
            targetId: curriculumSubjectId,
            metadata: {
              op: 'update',
              schoolId: existing.school_id,
              subjectCode: dto.subjectCode,
              coverageCount: coverage.length,
            },
            ip: null,
          },
          queryRunner,
        );
      });
      return await this.findSubject(curriculumSubjectId, actor);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รายวิชานี้มีอยู่ในหลักสูตรของชั้นและภาคเรียนนี้แล้ว');
      }
      if (isForeignKeyViolation(error)) {
        throw new BadRequestException(
          'ครูหรือห้องเรียนที่เลือกไม่อยู่ในโรงเรียน ภาคเรียน หรือชั้นนี้',
        );
      }
      throw error;
    }
  }

  async deleteSubject(curriculumSubjectId: string, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    let removedStorageKey: string | null = null;
    await this.repository.withTransaction(async (queryRunner) => {
      const existing = await this.repository.findSubjectById(
        curriculumSubjectId,
        queryRunner,
        true,
      );
      if (!existing) throw new NotFoundException('ไม่พบรายวิชาในหลักสูตร');
      await this.assertSchoolAccess(existing.school_id, actor);
      removedStorageKey = existing.content_storage_key;
      await this.repository.softDeleteSubjectOffering(curriculumSubjectId, actorId, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'curriculum_subjects',
          targetId: curriculumSubjectId,
          metadata: {
            op: 'delete',
            schoolId: existing.school_id,
            subjectCode: existing.subject_code,
          },
          ip: null,
        },
        queryRunner,
      );
    });
    if (removedStorageKey) {
      await this.storage.delete(removedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete curriculum content for ${curriculumSubjectId}`);
      });
    }
    return { success: true };
  }

  /**
   * Replaces or clears the learning-content PDF. The upload happens before the
   * write and is cleaned up if the write fails, so storage never keeps an orphan.
   */
  async updateContent(
    curriculumSubjectId: string,
    actor: AuthenticatedRequestUser,
    file?: Express.Multer.File,
    removeContent?: boolean,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (file && removeContent) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำไฟล์ออกพร้อมกันได้');
    }
    if (!file && !removeContent) {
      throw new BadRequestException('กรุณาเลือกไฟล์ PDF หรือระบุการนำไฟล์ออก');
    }

    const existing = await this.repository.findSubjectById(curriculumSubjectId);
    if (!existing) throw new NotFoundException('ไม่พบรายวิชาในหลักสูตร');
    await this.assertSchoolAccess(existing.school_id, actor);

    const storageKey = file ? await processCurriculumPdf(file, this.storage) : null;
    let replacedStorageKey: string | null = null;
    let transactionCommitted = false;

    try {
      await this.repository.withTransaction(async (queryRunner) => {
        const locked = await this.repository.findSubjectById(
          curriculumSubjectId,
          queryRunner,
          true,
        );
        if (!locked) throw new NotFoundException('ไม่พบรายวิชาในหลักสูตร');
        await this.assertSchoolAccess(locked.school_id, actor);
        replacedStorageKey = locked.content_storage_key;
        await this.repository.updateContent(
          curriculumSubjectId,
          storageKey && file
            ? {
                storageKey,
                fileName: file.originalname.slice(0, 255),
                sizeBytes: file.size,
              }
            : null,
          actorId,
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'curriculum_subjects',
            targetId: curriculumSubjectId,
            metadata: {
              op: storageKey ? 'update-content' : 'remove-content',
              schoolId: existing.school_id,
            },
            ip: null,
          },
          queryRunner,
        );
      });
      transactionCommitted = true;
    } catch (error) {
      if (storageKey && !transactionCommitted) {
        await this.storage.delete(storageKey).catch(() => {
          this.logger.warn(`Unable to delete unused curriculum content for ${curriculumSubjectId}`);
        });
      }
      throw error;
    }

    if (replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced curriculum content for ${curriculumSubjectId}`);
      });
    }
    return await this.findSubject(curriculumSubjectId, actor);
  }

  /**
   * Content is school data, so reads go through the scope check and then the
   * storage adapter — a short-lived signed URL on object storage, never a public
   * link.
   */
  async resolveContent(
    curriculumSubjectId: string,
    actor: AuthenticatedRequestUser,
  ): Promise<{ result: FileServeResult; fileName: string }> {
    const row = await this.repository.findSubjectById(curriculumSubjectId);
    if (!row?.content_storage_key) throw new NotFoundException('ไม่พบไฟล์สาระการเรียนรู้');
    await this.assertSchoolAccess(row.school_id, actor);
    const result = await this.storage.resolve(row.content_storage_key);
    if (!result) throw new NotFoundException('ไม่พบไฟล์สาระการเรียนรู้');
    return { result, fileName: row.content_file_name ?? 'curriculum.pdf' };
  }
}
