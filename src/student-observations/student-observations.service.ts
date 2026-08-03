import {
  BadRequestException,
  forwardRef,
  Inject,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
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
import { getBangkokDateString } from '../common/utils/date.util';
import { TeacherAccessService } from '../teacher-access/teacher-access.service';
import type { ActiveTeacherGrantContext } from '../teacher-access/teacher-access.types';
import { TaskAccessService } from '../task/task-access.service';
import { TaskRepository } from '../task/task.repository';
import type {
  CreatePublicStudentObservationDto,
  CreateTaskLinkStudentObservationDto,
  CreateStudentObservationDto,
  ListStudentObservationsQueryDto,
  UpdateObservationCatalogItemDto,
  UpdateStudentObservationDto,
  TaskLinkStudentObservationQueryDto,
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
  userId: number;
  username: string;
  teacherMembershipId: number | null;
  grantId: string | null;
  sourceAssignmentId: number | null;
  sourceTaskLinkId: string | null;
  sourceTimetableSlotId: number | null;
  observerDisplayName: string | null;
}

interface TaskLinkObservationContext {
  linkId: string;
  creatorUserId: number;
  observerDisplayName: string;
  schoolId: number;
  selectedTimetableSlotId: number | null;
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
    private readonly taskAccess: TaskAccessService,
    private readonly taskRepository: TaskRepository,
  ) {}

  private denyExecutiveRaw(actor: AuthenticatedRequestUser): void {
    if (
      actor.roles.includes('EXECUTIVE') &&
      !actor.roles.some((role) => role === 'ADMIN' || role === 'DIRECTOR')
    ) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะข้อมูลสรุปที่ไม่เปิดเผยข้อความดิบ');
    }
  }

  private canManage(actor: AuthenticatedRequestUser): boolean {
    return hasPermission(actor.roles, actor.permissions, 'manage-student-observations');
  }

  private canUseTeacherObservations(actor: AuthenticatedRequestUser): boolean {
    return hasPermission(actor.roles, actor.permissions, 'student-observations');
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
    const enrollment = await this.findEnrollment(studentUuid, queryRunner);
    if (this.canManage(actor)) {
      await this.assertEnrollmentScopeAccess(actor, enrollment);
      return { enrollment, assignment: null };
    }
    if (!this.canUseTeacherObservations(actor)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูข้อสังเกตนักเรียน');
    }
    await this.assertEnrollmentScopeAccess(actor, enrollment);
    const assignment = await this.repository.findActorAssignment(
      actor.id,
      studentUuid,
      getBangkokDateString(),
      queryRunner,
    );
    return { enrollment, assignment };
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
      : timetableSlotId && !this.canManage(actor)
        ? await this.repository.findActorAssignmentForTimetableSlot(
            actor.id,
            studentUuid,
            timetableSlotId,
            onDate,
            queryRunner,
          )
        : readAccess.assignment;
    if (!this.canManage(actor) && !assignment && assignmentId) {
      throw new NotFoundException('ไม่พบการมอบหมายครูที่ใช้งานได้สำหรับนักเรียน');
    }
    if (!this.canManage(actor) && !assignment && timetableSlotId) {
      const slotMatchesEnrollment = await this.repository.isTimetableSlotForEnrollment(
        timetableSlotId,
        readAccess.enrollment,
        queryRunner,
      );
      if (!slotMatchesEnrollment) {
        throw new NotFoundException('ไม่พบคาบเรียนในห้องของนักเรียน');
      }
    }
    if (assignment && !this.canManage(actor) && assignment.teacher_user_id !== actor.id) {
      throw new NotFoundException('assignment อยู่นอกขอบเขตของคุณ');
    }
    return {
      enrollment: readAccess.enrollment,
      actorContext: {
        kind: 'USER',
        userId: actor.id,
        username: actor.username,
        teacherMembershipId:
          assignment?.teacher_user_id === actor.id
            ? Number(assignment.teacher_membership_id)
            : null,
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

  private async resolveTaskLinkObservationContext(
    rawToken: string,
    sessionToken: string,
    studentUuid?: string,
    timetableSlotId?: number,
  ): Promise<TaskLinkObservationContext> {
    const task = await this.taskAccess.getTaskByToken(rawToken, sessionToken || undefined);
    if (!task) throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    if (task.error) {
      const message = typeof task.error === 'string' ? task.error : 'ลิงก์ใช้งานไม่ได้';
      if (task.status === 'EXPIRED') throw new GoneException(message);
      if (task.status === 'ADMIN_LOCKED' || task.status === 'SCHEDULED') {
        throw new ForbiddenException(message);
      }
      throw new ConflictException(message);
    }
    if (task.task_type !== 'ATTENDANCE') {
      throw new ForbiddenException('ลิงก์นี้ไม่รองรับการบันทึกข้อสังเกตนักเรียน');
    }
    if (task.auth_required === true) {
      throw new ForbiddenException('กรุณายืนยัน OTP ก่อนบันทึกข้อสังเกต');
    }
    const linkId = typeof task.link_id === 'string' ? task.link_id : '';
    if (!linkId) throw new ConflictException('ลิงก์ไม่มีข้อมูลอ้างอิงที่ใช้งานได้');
    const link = await this.taskRepository.findTaskLinkById(linkId);
    const creatorUserId = this.scalarNumber(link?.created_by);
    const schoolId = this.scalarNumber(task.target_school_id);
    const observerDisplayName =
      typeof task.assigned_to_name === 'string' ? task.assigned_to_name.trim() : '';
    if (!creatorUserId || !schoolId || !observerDisplayName) {
      throw new ConflictException('ลิงก์ไม่มีข้อมูลผู้บันทึกหรือขอบเขตโรงเรียนที่ครบถ้วน');
    }

    const linkedSlots = await this.taskRepository.listLinkedTimetableSlots(linkId);
    if (studentUuid && linkedSlots.length > 0 && !timetableSlotId) {
      throw new BadRequestException('กรุณาเลือกคาบเรียนของข้อสังเกต');
    }
    if (
      timetableSlotId &&
      !linkedSlots.some((slot) => Number(slot.id) === Number(timetableSlotId))
    ) {
      throw new ForbiddenException('คาบเรียนอยู่นอกขอบเขตของลิงก์');
    }

    if (studentUuid) {
      const roster = await this.taskRepository.listTaskStudents({
        targetGrade: typeof task.target_grade === 'string' ? task.target_grade : null,
        targetRoom: typeof task.target_room === 'string' ? task.target_room : null,
        targetSchoolId: schoolId,
      });
      if (!roster.some((student) => String(student.id) === studentUuid)) {
        throw new ForbiddenException('นักเรียนอยู่นอกขอบเขตของลิงก์');
      }
    }

    return {
      linkId,
      creatorUserId,
      observerDisplayName,
      schoolId,
      selectedTimetableSlotId: timetableSlotId ?? null,
    };
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
    return await this.repository.withTransaction(async (queryRunner) => {
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
          actorUserId: actor.id,
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
  }

  async list(
    studentUuid: string,
    query: ListStudentObservationsQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    const access = await this.resolveLoggedReadAccess(actor, studentUuid);
    const result = await this.listInternal(studentUuid, query);
    await this.auditLog.record({
      actorUserId: actor.id,
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
    return await this.repository.withTransaction(async (queryRunner) => {
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
          teacherMembershipId:
            assignment?.teacher_user_id === actor.id
              ? Number(assignment.teacher_membership_id)
              : null,
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
          actorUserId: actor.id,
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
    return await this.teacherAccess.withActiveGrantContext(
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
            userId: grant.teacherUserId,
            username: grant.teacherUsername,
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
            actorUserId: grant.teacherUserId,
            actorLabel: grant.teacherUsername,
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
            actorUserId: grant.teacherUserId,
            actorLabel: grant.teacherUsername,
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
    return await this.teacherAccess.withActiveGrantContext(
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
        if (current.author_user_id !== grant.teacherUserId) {
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
            userId: grant.teacherUserId,
            username: grant.teacherUsername,
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
          grant.teacherUserId,
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: grant.teacherUserId,
            actorLabel: grant.teacherUsername,
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
    if (!this.canManage(actor) && !this.canUseTeacherObservations(actor)) {
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

  async getCatalogWithTaskLink(rawToken: string, sessionToken: string) {
    await this.resolveTaskLinkObservationContext(rawToken, sessionToken);
    const catalog = await this.repository.listCatalog();
    return {
      data: {
        dimensions: catalog.dimensions
          .filter((row) => row.is_active)
          .map((row) => this.toDimension(row)),
        tags: catalog.tags.filter((row) => row.is_active).map((row) => this.toTag(row)),
      },
    };
  }

  async createWithTaskLink(
    rawToken: string,
    sessionToken: string,
    dto: CreateTaskLinkStudentObservationDto,
  ) {
    return await this.repository.withTransaction(async (queryRunner) => {
      const context = await this.resolveTaskLinkObservationContext(
        rawToken,
        sessionToken,
        dto.studentTermId,
        dto.timetableSlotId,
      );
      const enrollment = await this.findEnrollment(dto.studentTermId, queryRunner);
      if (enrollment.school_id !== context.schoolId) {
        throw new ForbiddenException('นักเรียนอยู่นอกขอบเขตโรงเรียนของลิงก์');
      }
      const input = await this.resolveWriteInput(
        dto,
        enrollment,
        {
          kind: 'USER',
          userId: context.creatorUserId,
          username: context.observerDisplayName,
          teacherMembershipId: null,
          grantId: null,
          sourceAssignmentId: null,
          sourceTaskLinkId: context.linkId,
          sourceTimetableSlotId: context.selectedTimetableSlotId,
          observerDisplayName: context.observerDisplayName,
        },
        queryRunner,
      );
      const row = await this.repository.createObservation(input, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: context.creatorUserId,
          actorLabel: context.observerDisplayName,
          action: 'STUDENT_OBSERVATION_CREATE',
          targetType: 'student_observations',
          targetId: row.id,
          metadata: { ...this.auditMetadata(row), sourceTaskLinkId: context.linkId },
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toObservation(row) };
    });
  }

  async listWithTaskLink(
    rawToken: string,
    sessionToken: string,
    query: TaskLinkStudentObservationQueryDto,
  ) {
    const context = await this.resolveTaskLinkObservationContext(
      rawToken,
      sessionToken,
      query.studentTermId,
      query.timetableSlotId,
    );
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listTaskLinkObservations(
      query.studentTermId,
      context.linkId,
      context.selectedTimetableSlotId,
      page,
      limit,
    );
    return {
      data: rows.map((row) => this.toObservation(row)),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
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
          actorUserId: actor.id,
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
          actorUserId: actor.id,
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
