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
import { TaskRepository } from '../task/task.repository';
import { TeacherAccessService } from '../teacher-access/teacher-access.service';
import type { ActiveTeacherGrantContext } from '../teacher-access/teacher-access.types';
import type {
  CreateRiskReviewDto,
  HumanRiskReviewResponseDto,
  ListTeacherWatchlistQueryDto,
  StudentClassroomCommentResponseDto,
  TeacherWatchlistResponseDto,
} from './dto/observation-reviews.dto';
import { ObservationReviewsRepository } from './observation-reviews.repository';
import type {
  ObservationReviewEnrollmentRow,
  ObservationSourceRef,
  RiskReviewRow,
  StudentClassroomCommentRow,
  TeacherWatchlistRow,
  ValidatedObservationSourceRow,
} from './observation-reviews.types';

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
    if (!hasPermission(actor.roles, actor.permissions, 'students')) {
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
    if (!hasPermission(actor.roles, actor.permissions, 'students')) {
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

  /** หน้าความคิดเห็นจากคุณครู — every teacher comment inside the actor scope. */
  async listClassroomComments(
    query: { page?: number; limit?: number; searchTerm?: string },
    actor: AuthenticatedRequestUser,
  ) {
    const scope = this.managerQueueScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listClassroomComments(scope, {
      page,
      limit,
      searchTerm: query.searchTerm,
    });
    const totalCount = Number(rows[0]?.total_count ?? 0);
    return {
      data: rows.map((row) => ({
        id: row.id,
        studentUuid: row.student_uuid,
        studentName: row.student_name,
        schoolName: row.school_name,
        gradeLabel: row.grade_label,
        roomNo: row.room_no,
        comment: row.comment,
        authorDisplayName: row.author_display_name,
        commentedAt: new Date(row.commented_at).toISOString(),
      })),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
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
}
