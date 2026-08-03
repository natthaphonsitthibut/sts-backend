import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import {
  hasPermission,
  isUnconfiguredDataScope,
  resolveActorDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { getBangkokDateString } from '../common/utils/date.util';
import { createSqlQueryExecutor } from '../database/sql-query';
import { TaskRepository } from '../task/task.repository';
import { TeacherAccessService } from '../teacher-access/teacher-access.service';
import type { ActiveTeacherGrantContext } from '../teacher-access/teacher-access.types';
import type {
  CreateFollowUpRequestDto,
  CreatePublicFollowUpRequestDto,
  CreateRiskReviewDto,
  HomeVisitRequestReportResponseDto,
  HumanRiskReviewResponseDto,
  ListFollowUpRequestsQueryDto,
  ListHomeVisitRequestsQueryDto,
  ListTeacherObservationReportsQueryDto,
  ListTeacherWatchlistQueryDto,
  ReviewFollowUpRequestDto,
  StudentClassroomCommentResponseDto,
  StudentFollowUpRequestResponseDto,
  TeacherObservationReportResponseDto,
  TeacherWatchlistResponseDto,
} from './dto/observation-reviews.dto';
import { ObservationReviewsRepository } from './observation-reviews.repository';
import type {
  FollowUpRequestRow,
  ObservationReviewAssignmentRow,
  ObservationReviewEnrollmentRow,
  ObservationSourceRef,
  RiskReviewRow,
  StudentClassroomCommentRow,
  TeacherObservationReportRow,
  TeacherWatchlistRow,
  ValidatedObservationSourceRow,
} from './observation-reviews.types';

interface TeacherRequestActor {
  userId: number;
  username: string;
  teacherMembershipId: number;
  teacherGrantId: string | null;
  assignmentId: number;
}

@Injectable()
export class ObservationReviewsService {
  constructor(
    private readonly repository: ObservationReviewsRepository,
    private readonly auditLog: AuditLogService,
    private readonly teacherAccess: TeacherAccessService,
    private readonly taskRepository: TaskRepository,
  ) {}

  private denyExecutiveRaw(actor: AuthenticatedRequestUser): void {
    if (
      actor.roles.includes('EXECUTIVE') &&
      !actor.roles.some((role) => role === 'ADMIN' || role === 'DIRECTOR')
    ) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะข้อมูลสรุปที่ไม่เปิดเผยข้อมูลดิบ');
    }
  }

  private managerQueueScope(actor: AuthenticatedRequestUser): DataScope {
    this.denyExecutiveRaw(actor);
    if (!hasPermission(actor.roles, actor.permissions, 'manage-student-observations')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูข้อมูลข้อสังเกตและคำขอเยี่ยมบ้าน');
    }
    const scope = resolveActorDataScope(actor) ?? {};
    if (isUnconfiguredDataScope(scope) || scope.own_only === true) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ดูข้อมูลระดับโรงเรียน');
    }
    return scope;
  }

  private async requireManagerAccess(
    actor: AuthenticatedRequestUser,
    enrollment: ObservationReviewEnrollmentRow,
    queryRunner?: QueryRunner,
  ): Promise<void> {
    this.denyExecutiveRaw(actor);
    if (!hasPermission(actor.roles, actor.permissions, 'manage-student-observations')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ทบทวนความเสี่ยงหรือคำขอเยี่ยมบ้าน');
    }
    const scope = resolveActorDataScope(actor) ?? {};
    if (
      isUnconfiguredDataScope(scope) ||
      scope.own_only === true ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ทบทวนข้อมูลระดับโรงเรียน');
    }
    const allowed = await this.repository.isSchoolInScope(enrollment.school_id, scope, queryRunner);
    if (!allowed) throw new NotFoundException('ไม่พบนักเรียนในขอบเขตของคุณ');
  }

  private normalizeSources(sources: ObservationSourceRef[]): ObservationSourceRef[] {
    const seen = new Set<number>();
    for (const source of sources) {
      if (seen.has(source.observationId)) {
        throw new BadRequestException('ห้ามระบุข้อสังเกตซ้ำในคำขอเดียวกัน');
      }
      seen.add(source.observationId);
    }
    return sources;
  }

  private async validateSources(
    studentUuid: string,
    sources: ObservationSourceRef[],
    queryRunner: QueryRunner,
  ): Promise<ValidatedObservationSourceRow[]> {
    const normalized = this.normalizeSources(sources);
    const rows = await this.repository.validateObservationSources(
      studentUuid,
      normalized,
      queryRunner,
    );
    if (rows.length !== normalized.length) {
      throw new BadRequestException('ข้อสังเกตหรือ revision บางรายการไม่ตรงกับนักเรียน');
    }
    return rows;
  }

  private teacherConcernSignal(
    rows: ValidatedObservationSourceRow[],
  ): 'NONE' | 'WATCH' | 'CONCERN' {
    if (rows.some((row) => row.concern_level === 'CONCERN')) return 'CONCERN';
    if (rows.some((row) => row.concern_level === 'WATCH')) return 'WATCH';
    return 'NONE';
  }

  private parseSources(value: ObservationSourceRef[] | string): ObservationSourceRef[] {
    if (Array.isArray(value)) return value;
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as ObservationSourceRef[]) : [];
    } catch {
      return [];
    }
  }

  private toRiskReview(row: RiskReviewRow): HumanRiskReviewResponseDto {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      schoolId: row.school_id,
      calculatedAttendanceRisk: row.calculated_attendance_risk,
      teacherConcernSignal: row.teacher_concern_signal,
      humanRiskDecision: row.human_risk_decision,
      decisionReason: row.decision_reason,
      decidedBy: { userId: row.decided_by, username: row.decided_by_username },
      decidedAt: new Date(row.decided_at).toISOString(),
      revision: Number(row.revision_number),
      sourceObservations: this.parseSources(row.sources),
    };
  }

  private toFollowUp(row: FollowUpRequestRow): StudentFollowUpRequestResponseDto {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      schoolId: row.school_id,
      requestType: row.follow_up_request_type,
      status: row.status,
      statusPresentation: {
        labelTh: row.status_label_th,
        badgeVariant: row.status_badge_variant,
      },
      urgency: row.urgency,
      reason: row.request_reason,
      note: row.supplemental_note,
      requestedBy: { userId: row.requested_by, username: row.requested_by_username },
      assignmentId: Number(row.source_assignment_id),
      review:
        row.review_decision &&
        row.reviewed_by &&
        row.reviewed_by_username !== null &&
        row.reviewed_at
          ? {
              decision: row.review_decision,
              reason: row.review_reason,
              reviewedBy: { userId: row.reviewed_by, username: row.reviewed_by_username },
              reviewedAt: new Date(row.reviewed_at).toISOString(),
            }
          : null,
      assignment:
        row.assigned_task_id &&
        row.assigned_by &&
        row.assigned_by_username !== null &&
        row.assigned_at
          ? {
              taskId: row.assigned_task_id,
              assignedBy: { userId: row.assigned_by, username: row.assigned_by_username },
              assignedAt: new Date(row.assigned_at).toISOString(),
            }
          : null,
      openedCase:
        row.opened_case_id && row.opened_case_status
          ? { caseId: Number(row.opened_case_id), status: row.opened_case_status }
          : null,
      revision: Number(row.revision_number),
      sourceObservations: this.parseSources(row.sources),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private toHomeVisitRequestReport(row: FollowUpRequestRow): HomeVisitRequestReportResponseDto {
    return {
      ...this.toFollowUp(row),
      student: {
        studentTermId: row.student_uuid,
        displayName: row.student_name,
        schoolName: row.student_school ?? '-',
        gradeLabel: row.grade_label,
        roomNo: row.room_no === null ? null : Number(row.room_no),
      },
    };
  }

  private toTeacherObservationReport(
    row: TeacherObservationReportRow,
  ): TeacherObservationReportResponseDto {
    return {
      reportKind: row.report_kind,
      reportId: row.report_id,
      observationId: row.observation_id,
      observationRevision: Number(row.observation_revision),
      studentTermId: row.student_uuid,
      studentName: row.student_name,
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      gradeLevelId: row.grade_level_id === null ? null : Number(row.grade_level_id),
      gradeLabel: row.grade_label,
      classroomId: row.classroom_id,
      roomNo: row.room_no === null ? null : Number(row.room_no),
      authorDisplayName: row.author_display_name,
      dimensionLabel: row.dimension_label,
      concernLevel: row.concern_level,
      comment: row.comment,
      observedAt: new Date(row.observed_at).toISOString(),
      followUpRequestId: row.follow_up_request_id,
      followUpStatus: row.follow_up_status === 'NEED_MORE_INFO' ? null : row.follow_up_status,
      urgency: row.urgency,
      openedCaseId: row.opened_case_id === null ? null : Number(row.opened_case_id),
      openedCaseStatus: row.opened_case_status,
    };
  }

  private toTeacherWatchlist(row: TeacherWatchlistRow): TeacherWatchlistResponseDto {
    return {
      studentTermId: row.student_uuid,
      studentName: row.student_name,
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      gradeLabel: row.grade_label,
      roomNo: row.room_no === null ? null : Number(row.room_no),
      latestCommentId: row.latest_comment_id,
      latestComment: row.latest_comment,
      latestAuthorDisplayName: row.latest_author_display_name,
      latestCommentedAt: new Date(row.latest_commented_at).toISOString(),
      commentCount: Number(row.comment_count),
    };
  }

  private toStudentClassroomComment(
    row: StudentClassroomCommentRow,
  ): StudentClassroomCommentResponseDto {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      comment: row.comment,
      authorDisplayName: row.author_display_name,
      commentedAt: new Date(row.commented_at).toISOString(),
    };
  }

  async listTeacherObservationReports(
    query: ListTeacherObservationReportsQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    const scope = this.managerQueueScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listTeacherObservationReports(scope, {
      ...query,
      page,
      limit,
    });
    const data = rows.map((row) => this.toTeacherObservationReport(row));
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_observation_reports',
      targetId: 'teacher-reports',
      metadata: {
        resultCount: data.length,
        operation: 'TEACHER_OBSERVATION_REPORT_QUEUE_VIEW',
      },
      ip: null,
    });
    return {
      data,
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async listTeacherWatchlist(query: ListTeacherWatchlistQueryDto, actor: AuthenticatedRequestUser) {
    const scope = this.managerQueueScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listTeacherWatchlist(scope, {
      ...query,
      page,
      limit,
    });
    const data = rows.map((row) => this.toTeacherWatchlist(row));
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'classroom_student_comment_watchlist',
      targetId: 'classroom-comments',
      metadata: {
        resultCount: data.length,
        operation: 'CLASSROOM_STUDENT_COMMENT_WATCHLIST_VIEW',
      },
      ip: null,
    });
    return {
      data,
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async listStudentClassroomComments(studentTermId: string, actor: AuthenticatedRequestUser) {
    const scope = this.managerQueueScope(actor);
    const rows = await this.repository.listStudentClassroomComments(scope, studentTermId, 3);
    const data = rows.map((row) => this.toStudentClassroomComment(row));
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'classroom_student_comments',
      targetId: studentTermId,
      metadata: {
        resultCount: data.length,
        totalCount: Number(rows[0]?.total_count ?? 0),
        operation: 'STUDENT_CLASSROOM_COMMENTS_VIEW',
      },
      ip: null,
    });
    return {
      data,
      meta: { totalCount: Number(rows[0]?.total_count ?? 0) },
    };
  }

  async getTeacherObservationReport(observationId: string, actor: AuthenticatedRequestUser) {
    const scope = this.managerQueueScope(actor);
    const rows = await this.repository.listTeacherObservationReports(scope, {
      observationId,
      page: 1,
      limit: 1,
    });
    const row = rows[0];
    if (!row) throw new NotFoundException('ไม่พบรายละเอียดข้อสังเกต');
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_observations',
      targetId: observationId,
      metadata: { operation: 'TEACHER_OBSERVATION_REPORT_DETAIL_VIEW' },
      ip: null,
    });
    return { data: this.toTeacherObservationReport(row) };
  }

  async listHomeVisitRequests(
    query: ListHomeVisitRequestsQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    const scope = this.managerQueueScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listHomeVisitRequests(scope, { ...query, page, limit });
    const data = rows.map((row) => this.toHomeVisitRequestReport(row));
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_follow_up_requests',
      targetId: 'home-visit-requests',
      metadata: { resultCount: data.length, operation: 'HOME_VISIT_REQUEST_QUEUE_VIEW' },
      ip: null,
    });
    return {
      data,
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async getHomeVisitRequest(requestId: string, actor: AuthenticatedRequestUser) {
    const scope = this.managerQueueScope(actor);
    const rows = await this.repository.listHomeVisitRequests(scope, {
      requestId,
      page: 1,
      limit: 1,
    });
    const row = rows[0];
    if (!row) throw new NotFoundException('ไม่พบรายละเอียดคำขอเยี่ยมบ้าน');
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_follow_up_requests',
      targetId: requestId,
      metadata: { operation: 'HOME_VISIT_REQUEST_DETAIL_VIEW' },
      ip: null,
    });
    return { data: this.toHomeVisitRequestReport(row) };
  }

  async createRiskReview(
    studentUuid: string,
    dto: CreateRiskReviewDto,
    actor: AuthenticatedRequestUser,
  ) {
    return await this.repository.withTransaction(async (queryRunner) => {
      const enrollment = await this.repository.lockEnrollment(studentUuid, queryRunner);
      if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
      await this.requireManagerAccess(actor, enrollment, queryRunner);
      const reason = dto.decisionReason.trim();
      if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลของผลทบทวน');
      const latest = await this.repository.findLatestRiskReview(studentUuid, queryRunner);
      const currentRevision = Number(latest?.revision_number ?? 0);
      if (currentRevision !== dto.expectedRevision) {
        throw new ConflictException('ผลทบทวนถูกเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
      }
      const sourceRows = dto.sourceObservations.length
        ? await this.validateSources(studentUuid, dto.sourceObservations, queryRunner)
        : [];
      const calculatedAttendanceRisk = await this.repository.findCalculatedAttendanceRisk(
        studentUuid,
        queryRunner,
      );
      const row = await this.repository.insertRiskReview(
        {
          studentUuid,
          schoolId: enrollment.school_id,
          calculatedAttendanceRisk,
          teacherConcernSignal: this.teacherConcernSignal(sourceRows),
          humanRiskDecision: dto.humanRiskDecision,
          decisionReason: reason,
          decidedBy: actor.id,
          revision: currentRevision + 1,
          sources: dto.sourceObservations,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: actor.username,
          action: 'STUDENT_OBSERVATION_UPDATE',
          targetType: 'student_observation_risk_reviews',
          targetId: row.id,
          metadata: {
            schoolId: enrollment.school_id,
            studentTermId: studentUuid,
            revision: Number(row.revision_number),
            humanRiskDecision: row.human_risk_decision,
            sourceCount: dto.sourceObservations.length,
            operation: 'HUMAN_RISK_DECISION_RECORDED',
          },
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toRiskReview(row) };
    });
  }

  async getLatestRiskReview(studentUuid: string, actor: AuthenticatedRequestUser) {
    const enrollment = await this.repository.findEnrollment(studentUuid);
    if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
    await this.requireManagerAccess(actor, enrollment);
    const [row, currentCalculatedAttendanceRisk] = await Promise.all([
      this.repository.findLatestRiskReview(studentUuid),
      this.repository.findCalculatedAttendanceRisk(studentUuid),
    ]);
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_term',
      targetId: studentUuid,
      metadata: {
        schoolId: enrollment.school_id,
        hasDecision: row !== null,
        operation: 'HUMAN_RISK_REVIEW_VIEW',
      },
      ip: null,
    });
    return {
      data: row ? this.toRiskReview(row) : null,
      meta: { currentCalculatedAttendanceRisk },
    };
  }

  private async resolveLoggedTeacher(
    actor: AuthenticatedRequestUser,
    studentUuid: string,
    assignmentId: number | undefined,
    queryRunner: QueryRunner,
  ): Promise<{ enrollment: ObservationReviewEnrollmentRow; requester: TeacherRequestActor }> {
    this.denyExecutiveRaw(actor);
    if (!hasPermission(actor.roles, actor.permissions, 'student-observations')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ส่งคำขอให้พิจารณาติดตาม');
    }
    const enrollment = await this.repository.lockEnrollment(studentUuid, queryRunner);
    if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
    const assignment = assignmentId
      ? await this.repository.findActiveAssignment(
          assignmentId,
          studentUuid,
          getBangkokDateString(),
          queryRunner,
        )
      : await this.repository.findActiveAssignmentForTeacher(
          actor.id,
          studentUuid,
          getBangkokDateString(),
          queryRunner,
        );
    if (!assignment || assignment.teacher_user_id !== actor.id) {
      throw new NotFoundException('ไม่พบนักเรียนใน assignment ที่ใช้งานได้');
    }
    this.assertAssignmentMatchesEnrollment(assignment, enrollment);
    return {
      enrollment,
      requester: {
        userId: actor.id,
        username: actor.username,
        teacherMembershipId: Number(assignment.teacher_membership_id),
        teacherGrantId: null,
        assignmentId: Number(assignment.assignment_id),
      },
    };
  }

  private assertAssignmentMatchesEnrollment(
    assignment: ObservationReviewAssignmentRow,
    enrollment: ObservationReviewEnrollmentRow,
  ): void {
    if (
      assignment.school_id !== enrollment.school_id ||
      String(assignment.school_term_id) !== enrollment.school_term_id ||
      String(assignment.classroom_id) !== enrollment.classroom_id
    ) {
      throw new ForbiddenException('assignment ไม่ตรงกับ enrollment ที่ร้องขอ');
    }
  }

  private assertGrantMatchesEnrollment(
    grant: ActiveTeacherGrantContext,
    enrollment: ObservationReviewEnrollmentRow,
  ): void {
    if (
      grant.schoolId !== enrollment.school_id ||
      String(grant.schoolTermId) !== enrollment.school_term_id ||
      String(grant.classroomId) !== enrollment.classroom_id
    ) {
      throw new ForbiddenException('enrollment อยู่นอกขอบเขตของลิงก์');
    }
  }

  private async createFollowUpInternal(
    studentUuid: string,
    dto: CreateFollowUpRequestDto,
    enrollment: ObservationReviewEnrollmentRow,
    requester: TeacherRequestActor,
    queryRunner: QueryRunner,
  ) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลของคำขอ');
    const sources = dto.sourceObservations ?? [];
    if (sources.length > 0) {
      await this.validateSources(studentUuid, sources, queryRunner);
    }
    const pending = await this.repository.findPendingFollowUpForUpdate(studentUuid, queryRunner);
    let requestId: string;
    let created: boolean;
    if (pending) {
      requestId = pending.id;
      created = false;
      await this.repository.mergePendingFollowUp(requestId, dto.urgency, queryRunner);
    } else {
      requestId = await this.repository.createFollowUpRequest(
        {
          studentUuid,
          schoolId: enrollment.school_id,
          urgency: dto.urgency,
          reason,
          note: dto.note?.trim() || null,
          requestedBy: requester.userId,
          teacherMembershipId: requester.teacherMembershipId,
          teacherGrantId: requester.teacherGrantId,
          assignmentId: requester.assignmentId,
        },
        queryRunner,
      );
      created = true;
    }
    await this.repository.addFollowUpSources(
      requestId,
      sources,
      requester.userId,
      requester.teacherGrantId,
      queryRunner,
    );
    const row = await this.repository.findFollowUpById(studentUuid, requestId, queryRunner);
    if (!row) throw new ConflictException('ไม่สามารถอ่านคำขอเยี่ยมบ้านหลังบันทึกได้');
    await this.auditLog.recordAtomic(
      {
        actorUserId: requester.userId,
        actorLabel: requester.username,
        action: 'STUDENT_OBSERVATION_UPDATE',
        targetType: 'student_follow_up_requests',
        targetId: row.id,
        metadata: {
          schoolId: enrollment.school_id,
          studentTermId: studentUuid,
          urgency: row.urgency,
          sourceCount: sources.length,
          created,
          operation: created
            ? 'STUDENT_FOLLOW_UP_REQUEST_CREATE'
            : 'STUDENT_FOLLOW_UP_SOURCE_ATTACH',
        },
        ip: null,
      },
      queryRunner,
    );
    return { data: this.toFollowUp(row), meta: { created } };
  }

  async createFollowUp(
    studentUuid: string,
    dto: CreateFollowUpRequestDto,
    actor: AuthenticatedRequestUser,
  ) {
    return await this.repository.withTransaction(async (queryRunner) => {
      const access = await this.resolveLoggedTeacher(
        actor,
        studentUuid,
        dto.assignmentId,
        queryRunner,
      );
      return await this.createFollowUpInternal(
        studentUuid,
        dto,
        access.enrollment,
        access.requester,
        queryRunner,
      );
    });
  }

  private async listFollowUpsInternal(
    studentUuid: string,
    query: ListFollowUpRequestsQueryDto,
    queryRunner?: QueryRunner,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listFollowUps(studentUuid, page, limit, queryRunner);
    return {
      data: rows.map((row) => this.toFollowUp(row)),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async listFollowUps(
    studentUuid: string,
    query: ListFollowUpRequestsQueryDto,
    actor: AuthenticatedRequestUser,
  ) {
    this.denyExecutiveRaw(actor);
    const enrollment = await this.repository.findEnrollment(studentUuid);
    if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
    if (hasPermission(actor.roles, actor.permissions, 'manage-student-observations')) {
      await this.requireManagerAccess(actor, enrollment);
    } else {
      if (!query.assignmentId) throw new BadRequestException('ครูต้องระบุ assignmentId');
      return await this.repository.withTransaction(async (queryRunner) => {
        await this.resolveLoggedTeacher(actor, studentUuid, query.assignmentId, queryRunner);
        const result = await this.listFollowUpsInternal(studentUuid, query, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actor.id,
            actorLabel: actor.username,
            action: 'STUDENT_OBSERVATION_VIEW',
            targetType: 'student_term',
            targetId: studentUuid,
            metadata: {
              schoolId: enrollment.school_id,
              resultCount: result.data.length,
              operation: 'STUDENT_FOLLOW_UP_REQUEST_VIEW',
            },
            ip: null,
          },
          queryRunner,
        );
        return result;
      });
    }
    const result = await this.listFollowUpsInternal(studentUuid, query);
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: actor.username,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'student_term',
      targetId: studentUuid,
      metadata: {
        schoolId: enrollment.school_id,
        resultCount: result.data.length,
        operation: 'STUDENT_FOLLOW_UP_REQUEST_VIEW',
      },
      ip: null,
    });
    return result;
  }

  async reviewFollowUp(
    studentUuid: string,
    requestId: string,
    dto: ReviewFollowUpRequestDto,
    actor: AuthenticatedRequestUser,
  ) {
    return await this.repository.withTransaction(async (queryRunner) => {
      const enrollment = await this.repository.lockEnrollment(studentUuid, queryRunner);
      if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
      await this.requireManagerAccess(actor, enrollment, queryRunner);
      const current = await this.repository.findFollowUpById(
        studentUuid,
        requestId,
        queryRunner,
        true,
      );
      if (!current) throw new NotFoundException('ไม่พบคำขอเยี่ยมบ้าน');
      if (current.status !== 'PENDING_REVIEW') {
        throw new ConflictException('คำขอนี้ได้รับการทบทวนแล้ว');
      }
      if (Number(current.revision_number) !== dto.expectedRevision) {
        throw new ConflictException('คำขอถูกเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
      }
      const reason = dto.reason.trim();
      if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลของผลทบทวน');
      const studentName = current.student_name.trim();
      if (dto.decision === 'APPROVED' && !studentName) {
        throw new ConflictException('ข้อมูลนักเรียนไม่มีชื่อสำหรับเปิดเคส');
      }
      const openedCaseId =
        dto.decision === 'APPROVED'
          ? await this.taskRepository.createCase(
              {
                studentName,
                studentFirstName: current.student_first_name,
                studentLastName: current.student_last_name,
                studentSchool: current.student_school,
                studentAddress: current.student_address,
                addressLine: current.address_line,
                addressProvince: current.address_province,
                addressDistrict: current.address_district,
                addressSubDistrict: current.address_sub_district,
                postalCode: current.postal_code,
                studentLat: current.student_lat,
                studentLng: current.student_lng,
                reasonFlagged: current.request_reason,
                studentUuid,
                schoolId: enrollment.school_id,
                createdBy: actor.id,
              },
              createSqlQueryExecutor(queryRunner),
            )
          : null;
      const updated = await this.repository.reviewFollowUp(
        requestId,
        dto.expectedRevision,
        dto.decision,
        reason,
        actor.id,
        openedCaseId,
        queryRunner,
      );
      if (!updated) throw new ConflictException('คำขอถูกเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่');
      const row = await this.repository.findFollowUpById(studentUuid, requestId, queryRunner);
      if (!row) throw new ConflictException('ไม่สามารถอ่านผลทบทวนหลังบันทึกได้');
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: actor.username,
          action: 'STUDENT_OBSERVATION_UPDATE',
          targetType: 'student_follow_up_requests',
          targetId: row.id,
          metadata: {
            schoolId: enrollment.school_id,
            studentTermId: studentUuid,
            decision: dto.decision,
            openedCaseId,
            revision: Number(row.revision_number),
            operation: 'STUDENT_FOLLOW_UP_REQUEST_REVIEW',
          },
          ip: null,
        },
        queryRunner,
      );
      return { data: this.toFollowUp(row) };
    });
  }

  async createFollowUpWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    dto: CreatePublicFollowUpRequestDto,
  ) {
    return await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId: dto.assignmentId,
        studentUuid,
        operation: 'CREATE_STUDENT_FOLLOW_UP_REQUEST',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.repository.lockEnrollment(studentUuid, queryRunner);
        if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
        this.assertGrantMatchesEnrollment(grant, enrollment);
        const assignment = await this.repository.findActiveAssignment(
          dto.assignmentId,
          studentUuid,
          getBangkokDateString(),
          queryRunner,
        );
        if (
          !assignment ||
          Number(assignment.teacher_membership_id) !== Number(grant.teacherMembershipId)
        ) {
          throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        }
        return await this.createFollowUpInternal(
          studentUuid,
          dto,
          enrollment,
          {
            userId: grant.teacherUserId,
            username: grant.teacherUsername,
            teacherMembershipId: Number(grant.teacherMembershipId),
            teacherGrantId: grant.grantId,
            assignmentId: dto.assignmentId,
          },
          queryRunner,
        );
      },
    );
  }

  async listFollowUpsWithTeacherAccess(
    rawToken: string,
    studentUuid: string,
    assignmentId: number,
    query: ListFollowUpRequestsQueryDto,
  ) {
    return await this.teacherAccess.withActiveGrantContext(
      rawToken,
      {
        capability: 'TEACHER_OBSERVATION',
        assignmentId,
        studentUuid,
        operation: 'VIEW_STUDENT_FOLLOW_UP_REQUESTS',
      },
      async (grant, queryRunner) => {
        const enrollment = await this.repository.lockEnrollment(studentUuid, queryRunner);
        if (!enrollment) throw new NotFoundException('ไม่พบข้อมูลการลงทะเบียนของนักเรียน');
        this.assertGrantMatchesEnrollment(grant, enrollment);
        const result = await this.listFollowUpsInternal(studentUuid, query, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: grant.teacherUserId,
            actorLabel: grant.teacherUsername,
            action: 'STUDENT_OBSERVATION_VIEW',
            targetType: 'student_term',
            targetId: studentUuid,
            metadata: {
              schoolId: enrollment.school_id,
              resultCount: result.data.length,
              operation: 'STUDENT_FOLLOW_UP_REQUEST_VIEW',
            },
            ip: null,
          },
          queryRunner,
        );
        return result;
      },
    );
  }
}
