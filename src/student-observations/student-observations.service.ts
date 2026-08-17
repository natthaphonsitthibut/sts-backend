import {
  BadRequestException,
  forwardRef,
  Inject,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { hasPermission, resolveActorDataScope, type AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { PaginationQueryDto } from '../common/pagination/pagination.dto';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { getBangkokDateString } from '../common/utils/date.util';
import { TeacherAccessService } from '../teacher-access/teacher-access.service';
import type { ActiveTeacherGrantContext } from '../teacher-access/teacher-access.types';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import type {
  CreatePublicStudentObservationDto,
  CreateStudentObservationDto,
  ListStudentObservationsQueryDto,
  UpdateObservationCatalogItemDto,
  UpdateStudentObservationDto,
} from './dto/student-observations.dto';
import { StudentObservationsRepository } from './student-observations.repository';
import type {
  ObservationAssignmentRow,
  ObservationBehaviorTagRow,
  ObservationDimensionRow,
  ObservationEnrollmentRow,
  ObservationWriteInput,
  StudentObservationRow,
} from './student-observations.types';

interface WriteActorContext {
  kind: 'USER' | 'TEACHER_ACCESS';
  userId: number | null;
  username: string;
  teacherMembershipId: number | null;
  grantId: string | null;
  sourceAssignmentId: number | null;
  sourceTaskLinkId: string | null;
  sourceTimetableSlotId: number | null;
  observerDisplayName: string | null;
}

@Injectable()
export class StudentObservationsService {
  constructor(
    private readonly repository: StudentObservationsRepository,
    private readonly auditLog: AuditLogService,
    // Circular by design: teacher-access reads observations for the link's
    // student profile, observations authorise through teacher-access.
    @Inject(forwardRef(() => TeacherAccessService))
    private readonly teacherAccess: TeacherAccessService,
    @Optional()
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  private async recalculateStudentRisk(studentUuid: string, reason: string): Promise<void> {
    await this.riskProfileService?.requestStudentRecalculation([studentUuid], reason);
  }

  private denyExecutiveRaw(actor: AuthenticatedRequestUser): void {
    if (
      actor.roles.includes('EXECUTIVE') &&
      !actor.roles.some((role) => role === 'ADMIN' || role === 'DIRECTOR')
    ) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะข้อมูลสรุปที่ไม่เปิดเผยข้อความดิบ');
    }
  }

  /**
   * Observing a student and managing a school's observations were two
   * permissions; both are work done on รายชื่อนักเรียน, so that page decides and
   * `data_scope` is what still separates a class teacher from a school manager.
   */
  private canManage(actor: AuthenticatedRequestUser): boolean {
    return hasPermission(actor.roles, actor.permissions, 'students');
  }

  private async findEnrollment(
    studentUuid: string,
    queryRunner?: QueryRunner,
  ): Promise<ObservationEnrollmentRow> {
    const enrollment = await this.repository.findEnrollment(studentUuid, queryRunner);
    if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
    return enrollment;
  }

  private async assertEnrollmentScopeAccess(
    actor: AuthenticatedRequestUser,
    enrollment: ObservationEnrollmentRow,
  ): Promise<void> {
    const allowed = await this.repository.isEnrollmentInScope(
      enrollment.student_uuid,
      resolveActorDataScope(actor) ?? {},
    );
    if (!allowed) throw new NotFoundException('ไม่พบนักเรียนในขอบเขตของคุณ');
  }

  private async resolveLoggedReadAccess(
    actor: AuthenticatedRequestUser,
    studentUuid: string,
    queryRunner?: QueryRunner,
  ): Promise<{
    enrollment: ObservationEnrollmentRow;
    assignment: ObservationAssignmentRow | null;
  }> {
    this.denyExecutiveRaw(actor);
    if (!this.canManage(actor)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูข้อสังเกตนักเรียน');
    }
    const enrollment = await this.findEnrollment(studentUuid, queryRunner);
    await this.assertEnrollmentScopeAccess(actor, enrollment);
    // A logged-in actor is staff. Teachers reach the system through an access
    // link, so there is no assignment to infer from the account — the caller
    // names one explicitly when the write belongs to a class.
    return { enrollment, assignment: null };
  }

  private async resolveLoggedWriteAccess(
    actor: AuthenticatedRequestUser,
    studentUuid: string,
    assignmentId: number | undefined,
    timetableSlotId: number | undefined,
    queryRunner: QueryRunner,
  ): Promise<{ enrollment: ObservationEnrollmentRow; actorContext: WriteActorContext }> {
    const readAccess = await this.resolveLoggedReadAccess(actor, studentUuid, queryRunner);
    const onDate = getBangkokDateString();
    const assignment = assignmentId
      ? await this.repository.findActiveAssignment(assignmentId, studentUuid, onDate, queryRunner)
      : readAccess.assignment;
    if (!assignment && assignmentId) {
      throw new NotFoundException('ไม่พบการมอบหมายครูที่ใช้งานได้สำหรับนักเรียน');
    }
    if (!assignment && timetableSlotId) {
      const slotMatchesEnrollment = await this.repository.isTimetableSlotForEnrollment(
        timetableSlotId,
        readAccess.enrollment,
        queryRunner,
      );
      if (!slotMatchesEnrollment) {
        throw new NotFoundException('ไม่พบคาบเรียนในห้องของนักเรียน');
      }
    }
    return {
      enrollment: readAccess.enrollment,
      actorContext: {
        kind: 'USER',
        userId: actor.id,
        username: actor.username,
        teacherMembershipId: null,
        grantId: null,
        sourceAssignmentId: assignment ? Number(assignment.assignment_id) : null,
        sourceTaskLinkId: null,
        sourceTimetableSlotId: timetableSlotId ?? null,
        observerDisplayName: null,
      },
    };
  }

  private assertTeacherGrantEnrollment(
    grant: ActiveTeacherGrantContext,
    enrollment: ObservationEnrollmentRow,
  ): void {
    if (
      grant.schoolId !== enrollment.school_id ||
      grant.schoolTermId !== enrollment.school_term_id ||
      grant.classroomId !== enrollment.classroom_id
    ) {
      throw new ForbiddenException('ข้อมูลการลงทะเบียนอยู่นอกขอบเขตของลิงก์');
    }
  }

  private scalarNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private async resolveWriteInput(
    dto: Pick<
      CreateStudentObservationDto,
      'dimensionCode' | 'concernLevel' | 'tagCodes' | 'comment' | 'observedAt'
    >,
    enrollment: ObservationEnrollmentRow,
    actor: WriteActorContext,
    queryRunner: QueryRunner,
    changeReason?: string | null,
  ): Promise<ObservationWriteInput> {
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime()))
      throw new BadRequestException('วันเวลาที่สังเกตไม่ถูกต้อง');
    if (observedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('วันเวลาที่สังเกตต้องไม่อยู่ในอนาคต');
    }
    const catalog = await this.repository.resolveCatalog(
      dto.dimensionCode,
      dto.tagCodes,
      queryRunner,
    );
    if (!catalog.dimension) throw new BadRequestException('ด้านที่พบไม่เปิดใช้งาน');
    if (catalog.tags.length !== dto.tagCodes.length) {
      throw new BadRequestException('มี behavior tag ที่ไม่เปิดใช้งาน');
    }
    if (
      catalog.tags.some(
        (tag) =>
          tag.observation_dimension_id !== null &&
          tag.observation_dimension_id !== catalog.dimension!.id,
      )
    ) {
      throw new BadRequestException('behavior tag ไม่ตรงกับด้านที่พบ');
    }
    const comment = dto.comment?.trim() || null;
    const commentRequired =
      dto.concernLevel === 'CONCERN' ||
      catalog.dimension.requires_comment ||
      catalog.tags.some((tag) => tag.requires_comment);
    if (commentRequired && !comment) {
      throw new BadRequestException('กรุณาระบุเหตุผลสั้น ๆ สำหรับข้อสังเกตนี้');
    }
    return {
      studentUuid: enrollment.student_uuid,
      schoolId: enrollment.school_id,
      authorKind: actor.kind,
      authorUserId: actor.userId,
      authorTeacherMembershipId: actor.teacherMembershipId,
      sourceTeacherAccessGrantId: actor.grantId,
      sourceAssignmentId: actor.sourceAssignmentId,
      sourceTaskLinkId: actor.sourceTaskLinkId,
      sourceTimetableSlotId: actor.sourceTimetableSlotId,
      observerDisplayName: actor.observerDisplayName,
      dimensionId: Number(catalog.dimension.id),
      concernLevel: dto.concernLevel,
      comment,
      commentRequired,
      observedAt,
      behaviorTagIds: catalog.tags.map((tag) => Number(tag.id)),
      changeReason: changeReason?.trim() || null,
    };
  }

  private toObservation(row: StudentObservationRow) {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      schoolId: row.school_id,
      author: {
        userId: row.author_user_id,
        username: row.author_username,
        displayName: row.author_display_name,
        source: row.author_kind,
      },
      assignmentId: row.source_assignment_id,
      sourceTaskLinkId: row.source_task_link_id,
      sourceTimetableSlotId: row.source_timetable_slot_id,
      subject:
        row.subject_id === null
          ? null
          : { id: row.subject_id, code: row.subject_code, name: row.subject_name },
      dimension: {
        id: row.observation_dimension_id,
        code: row.dimension_code,
        labelTh: row.dimension_label,
      },
      concernLevel: row.concern_level,
      tags: row.tags,
      comment: row.comment,
      observedAt: row.observed_at,
      revision: row.revision_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private auditMetadata(row: StudentObservationRow): Record<string, unknown> {
    return {
      schoolId: row.school_id,
      studentTermId: row.student_uuid,
      concernLevel: row.concern_level,
      revision: row.revision_number,
    };
  }

  async create(
    studentUuid: string,
    dto: CreateStudentObservationDto,
    actor: AuthenticatedRequestUser,
  ) {
    const result = await this.repository.withTransaction(async (queryRunner) => {
      const access = await this.resolveLoggedWriteAccess(
        actor,
        studentUuid,
        dto.assignmentId,
        dto.timetableSlotId,
        queryRunner,
      );
      const input = await this.resolveWriteInput(
        dto,
        access.enrollment,
        access.actorContext,
        queryRunner,
      );
      const row = await this.repository.createObservation(input, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: resolveAuditActorId(actor),
          actorLabel: actor.username,
          action: 'STUDENT_OBSERVATION_CREATE',
          targetType: 'student_observations',
          targetId: row.id,
          metadata: this.auditMetadata(row),
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toObservation(row) };
    });
    await this.recalculateStudentRisk(studentUuid, 'student-observation-created');
    return result;
  }

  async list(
    studentUuid: string,
    query: ListStudentObservationsQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    const access = await this.resolveLoggedReadAccess(actor, studentUuid);
    const result = await this.listInternal(studentUuid, query);
    await this.auditLog.record({
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_term',
      targetId: studentUuid,
      metadata: {
        schoolId: access.enrollment.school_id,
        studentTermId: studentUuid,
        resultCount: result.data.length,
      },
      ip: null,
    });
    return result;
  }

  private async listInternal(
    studentUuid: string,
    query: ListStudentObservationsQueryDto,
    queryRunner?: QueryRunner,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listObservations(
      studentUuid,
      { page, limit, concernLevel: query.concernLevel, dimensionCode: query.dimensionCode },
      queryRunner,
    );
    return {
      data: rows.map((row) => this.toObservation(row)),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  private mergedUpdate(
    current: StudentObservationRow,
    dto: UpdateStudentObservationDto,
  ): Pick<
    CreateStudentObservationDto,
    'dimensionCode' | 'concernLevel' | 'tagCodes' | 'comment' | 'observedAt'
  > {
    const changed =
      dto.dimensionCode !== undefined ||
      dto.concernLevel !== undefined ||
      dto.tagCodes !== undefined ||
      dto.comment !== undefined ||
      dto.observedAt !== undefined;
    if (!changed) throw new BadRequestException('ไม่พบข้อมูลที่ต้องการแก้ไข');
    return {
      dimensionCode: dto.dimensionCode ?? current.dimension_code,
      concernLevel: dto.concernLevel ?? current.concern_level,
      tagCodes: dto.tagCodes ?? current.tags.map((tag) => tag.code),
      comment: dto.comment !== undefined ? dto.comment : current.comment,
      observedAt:
        dto.observedAt ??
        (current.observed_at instanceof Date
          ? current.observed_at.toISOString()
          : new Date(current.observed_at).toISOString()),
    };
  }

  async update(
    studentUuid: string,
    observationId: string,
    dto: UpdateStudentObservationDto,
    actor: AuthenticatedRequestUser,
  ) {
    const result = await this.repository.withTransaction(async (queryRunner) => {
      const current = await this.repository.findObservationById(
        studentUuid,
        observationId,
        queryRunner,
        true,
      );
      if (!current) throw new NotFoundException('ไม่พบข้อสังเกต');
      const access = await this.resolveLoggedReadAccess(actor, studentUuid, queryRunner);
      if (!this.canManage(actor) && current.author_user_id !== actor.id) {
        throw new ForbiddenException('แก้ไขได้เฉพาะข้อสังเกตที่คุณบันทึก');
      }
      const assignment = access.assignment;
      if (!this.canManage(actor) && !assignment) {
        throw new ForbiddenException('assignment เดิมไม่เปิดใช้งานแล้ว');
      }
      if (current.revision_number !== dto.expectedRevision) {
        throw new ConflictException('ข้อสังเกตถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
      }
      const input = await this.resolveWriteInput(
        this.mergedUpdate(current, dto),
        access.enrollment,
        {
          kind: 'USER',
          userId: actor.id,
          username: actor.username,
          teacherMembershipId: null,
          grantId: null,
          sourceAssignmentId:
            current.source_assignment_id === null ? null : Number(current.source_assignment_id),
          sourceTaskLinkId: null,
          sourceTimetableSlotId: null,
          observerDisplayName: null,
        },
        queryRunner,
        dto.changeReason,
      );
      const row = await this.repository.updateObservation(
        observationId,
        input,
        current.revision_number + 1,
        actor.id,
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: resolveAuditActorId(actor),
          actorLabel: actor.username,
          action: 'STUDENT_OBSERVATION_UPDATE',
          targetType: 'student_observations',
          targetId: row.id,
          metadata: this.auditMetadata(row),
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toObservation(row) };
    });
    await this.recalculateStudentRisk(studentUuid, 'student-observation-updated');
    return result;
  }

  async listRevisions(
    studentUuid: string,
    observationId: string,
    query: PaginationQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    await this.resolveLoggedReadAccess(actor, studentUuid);
    const observation = await this.repository.findObservationById(studentUuid, observationId);
    if (!observation) throw new NotFoundException('ไม่พบข้อสังเกต');
    return await this.listRevisionsInternal(observationId, query);
  }

  private async listRevisionsInternal(
    observationId: string,
    query: PaginationQueryDto,
    queryRunner?: QueryRunner,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listRevisions(observationId, page, limit, queryRunner);
    return {
      data: rows.map((row) => ({
        revision: row.revision_number,
        dimension: { code: row.dimension_code, labelTh: row.dimension_label },
        concernLevel: row.concern_level,
        comment: row.comment,
        behaviorTagIds: row.behavior_tag_ids,
        observedAt: row.observed_at,
        changedBy: { userId: row.changed_by_user_id, displayName: row.changed_by_display_name },
        changeReason: row.change_reason,
        changedAt: row.changed_at,
      })),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async createWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    dto: CreatePublicStudentObservationDto,
    sessionToken?: string,
  ) {
    const result = await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId: dto.assignmentId,
        studentUuid,
        sessionToken,
        operation: 'CREATE_STUDENT_OBSERVATION',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.findEnrollment(studentUuid, queryRunner);
        this.assertTeacherGrantEnrollment(grant, enrollment);
        const assignment = await this.repository.findActiveAssignment(
          dto.assignmentId,
          studentUuid,
          getBangkokDateString(),
          queryRunner,
        );
        if (!assignment || assignment.teacher_membership_id !== grant.teacherMembershipId) {
          throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        }
        const input = await this.resolveWriteInput(
          dto,
          enrollment,
          {
            kind: 'TEACHER_ACCESS',
            userId: null,
            username: grant.teacherDisplayName,
            teacherMembershipId: Number(grant.teacherMembershipId),
            grantId: grant.grantId,
            sourceAssignmentId: Number(assignment.assignment_id),
            sourceTaskLinkId: null,
            sourceTimetableSlotId: null,
            observerDisplayName: null,
          },
          queryRunner,
        );
        const row = await this.repository.createObservation(input, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: null,
            actorLabel: grant.teacherDisplayName,
            action: 'STUDENT_OBSERVATION_CREATE',
            targetType: 'student_observations',
            targetId: row.id,
            metadata: this.auditMetadata(row),
            ip: null,
          },
          queryRunner,
        );
        return { data: this.toObservation(row) };
      },
    );
    await this.recalculateStudentRisk(studentUuid, 'teacher-observation-created');
    return result;
  }

  async listWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    assignmentId: number,
    query: ListStudentObservationsQueryDto,
    sessionToken?: string,
  ) {
    return await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId,
        studentUuid,
        sessionToken,
        operation: 'VIEW_STUDENT_OBSERVATIONS',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.findEnrollment(studentUuid, queryRunner);
        this.assertTeacherGrantEnrollment(grant, enrollment);
        const result = await this.listInternal(studentUuid, query, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: null,
            actorLabel: grant.teacherDisplayName,
            action: 'STUDENT_OBSERVATION_VIEW',
            targetType: 'student_term',
            targetId: studentUuid,
            metadata: {
              schoolId: grant.schoolId,
              studentTermId: studentUuid,
              resultCount: result.data.length,
            },
            ip: null,
          },
          queryRunner,
        );
        return result;
      },
    );
  }

  async updateWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    observationId: string,
    assignmentId: number,
    dto: UpdateStudentObservationDto,
    sessionToken?: string,
  ) {
    const result = await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId,
        studentUuid,
        sessionToken,
        operation: 'UPDATE_STUDENT_OBSERVATION',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.findEnrollment(studentUuid, queryRunner);
        this.assertTeacherGrantEnrollment(grant, enrollment);
        const current = await this.repository.findObservationById(
          studentUuid,
          observationId,
          queryRunner,
          true,
        );
        if (!current) throw new NotFoundException('ไม่พบข้อสังเกต');
        if (
          String(current.author_teacher_membership_id ?? '') !== String(grant.teacherMembershipId)
        ) {
          throw new ForbiddenException('แก้ไขได้เฉพาะข้อสังเกตที่ครูผู้ใช้ลิงก์นี้บันทึก');
        }
        if (current.revision_number !== dto.expectedRevision) {
          throw new ConflictException('ข้อสังเกตถูกแก้ไขโดยผู้อื่น กรุณาโหลดข้อมูลใหม่');
        }
        const assignment = await this.repository.findActiveAssignment(
          assignmentId,
          studentUuid,
          getBangkokDateString(),
          queryRunner,
        );
        if (!assignment || assignment.teacher_membership_id !== grant.teacherMembershipId) {
          throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        }
        const input = await this.resolveWriteInput(
          this.mergedUpdate(current, dto),
          enrollment,
          {
            kind: 'TEACHER_ACCESS',
            userId: null,
            username: grant.teacherDisplayName,
            teacherMembershipId: Number(grant.teacherMembershipId),
            grantId: grant.grantId,
            sourceAssignmentId: Number(assignment.assignment_id),
            sourceTaskLinkId: null,
            sourceTimetableSlotId: null,
            observerDisplayName: null,
          },
          queryRunner,
          dto.changeReason,
        );
        const row = await this.repository.updateObservation(
          observationId,
          input,
          current.revision_number + 1,
          null,
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: null,
            actorLabel: grant.teacherDisplayName,
            action: 'STUDENT_OBSERVATION_UPDATE',
            targetType: 'student_observations',
            targetId: row.id,
            metadata: this.auditMetadata(row),
            ip: null,
          },
          queryRunner,
        );
        return { data: this.toObservation(row) };
      },
    );
    await this.recalculateStudentRisk(studentUuid, 'teacher-observation-updated');
    return result;
  }

  async listRevisionsWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    observationId: string,
    assignmentId: number,
    query: PaginationQueryDto,
    sessionToken?: string,
  ) {
    return await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId,
        studentUuid,
        sessionToken,
        operation: 'VIEW_STUDENT_OBSERVATION_REVISIONS',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.findEnrollment(studentUuid, queryRunner);
        this.assertTeacherGrantEnrollment(grant, enrollment);
        const observation = await this.repository.findObservationById(
          studentUuid,
          observationId,
          queryRunner,
        );
        if (!observation) throw new NotFoundException('ไม่พบข้อสังเกต');
        return await this.listRevisionsInternal(observationId, query, queryRunner);
      },
    );
  }

  async getCatalog(actor: AuthenticatedRequestUser) {
    this.denyExecutiveRaw(actor);
    if (!this.canManage(actor)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดู catalog ข้อสังเกต');
    }
    const catalog = await this.repository.listCatalog();
    return {
      data: {
        dimensions: catalog.dimensions.map((row) => this.toDimension(row)),
        tags: catalog.tags.map((row) => this.toTag(row)),
      },
    };
  }

  async getCatalogWithTeacherAccess(rawToken: string, sessionToken?: string) {
    return await this.teacherAccess.withActiveGrantContext(
      rawToken,
      { capability: 'TEACHER_OBSERVATION', sessionToken, operation: 'VIEW_OBSERVATION_CATALOG' },
      async (_grant, queryRunner) => {
        const catalog = await this.repository.listCatalog(queryRunner);
        return {
          data: {
            dimensions: catalog.dimensions
              .filter((row) => row.is_active)
              .map((row) => this.toDimension(row)),
            tags: catalog.tags.filter((row) => row.is_active).map((row) => this.toTag(row)),
          },
        };
      },
    );
  }

  private toDimension(row: ObservationDimensionRow) {
    return {
      id: row.id,
      code: row.code,
      labelTh: row.label_th,
      requiresComment: row.requires_comment,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    };
  }

  private toTag(row: ObservationBehaviorTagRow) {
    return {
      id: row.id,
      code: row.code,
      labelTh: row.label_th,
      dimensionCode: row.dimension_code,
      requiresComment: row.requires_comment,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    };
  }

  private assertCatalogAdmin(actor: AuthenticatedRequestUser): void {
    if (!this.canManage(actor) || !actor.roles.includes('ADMIN')) {
      throw new ForbiddenException('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไข catalog ได้');
    }
  }

  async updateDimension(
    id: number,
    dto: UpdateObservationCatalogItemDto,
    actor: AuthenticatedRequestUser,
  ) {
    this.assertCatalogAdmin(actor);
    return await this.repository.withTransaction(async (queryRunner) => {
      const row = await this.repository.updateDimension(id, dto, actor.id, queryRunner);
      if (!row) throw new NotFoundException('ไม่พบด้านข้อสังเกต');
      await this.auditLog.recordAtomic(
        {
          actorUserId: resolveAuditActorId(actor),
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'observation_dimensions',
          targetId: row.id,
          metadata: { code: row.code },
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toDimension(row) };
    });
  }

  async updateTag(
    id: number,
    dto: UpdateObservationCatalogItemDto,
    actor: AuthenticatedRequestUser,
  ) {
    this.assertCatalogAdmin(actor);
    return await this.repository.withTransaction(async (queryRunner) => {
      const row = await this.repository.updateTag(id, dto, actor.id, queryRunner);
      if (!row) throw new NotFoundException('ไม่พบ behavior tag');
      await this.auditLog.recordAtomic(
        {
          actorUserId: resolveAuditActorId(actor),
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'observation_behavior_tags',
          targetId: row.id,
          metadata: { code: row.code },
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toTag(row) };
    });
  }
}
