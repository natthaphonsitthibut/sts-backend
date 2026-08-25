import { ForbiddenException, Injectable } from '@nestjs/common';
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
import type {
  ClassroomCommentReportResponseDto,
  StudentClassroomCommentResponseDto,
} from './dto/teacher-comments.dto';
import { TeacherCommentsRepository } from './teacher-comments.repository';
import type { ClassroomCommentListRow, StudentClassroomCommentRow } from './teacher-comments.types';

/** Comments a teacher wrote about a student — the only concern record the app keeps. */
@Injectable()
export class TeacherCommentsService {
  constructor(
    private readonly repository: TeacherCommentsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private denyExecutiveRaw(actor: AuthenticatedRequestUser): void {
    if (
      actor.roles.includes('EXECUTIVE') &&
      !actor.roles.some((role) => role === 'ADMIN' || role === 'DIRECTOR')
    ) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะข้อมูลสรุปที่ไม่เปิดเผยข้อมูลดิบ');
    }
  }

  private readerScope(actor: AuthenticatedRequestUser): DataScope {
    this.denyExecutiveRaw(actor);
    if (!hasPermission(actor.roles, actor.permissions, 'students')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูความคิดเห็นของคุณครู');
    }
    const scope = resolveActorDataScope(actor) ?? {};
    if (isUnconfiguredDataScope(scope) || scope.own_only === true) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ดูข้อมูลระดับโรงเรียน');
    }
    return scope;
  }

  private toStudentComment(row: StudentClassroomCommentRow): StudentClassroomCommentResponseDto {
    return {
      id: row.id,
      studentTermId: row.student_uuid,
      problemCategory: row.problem_category_code,
      problemCategoryLabel: row.problem_category_label,
      problemCategoryGuidance: row.problem_category_guidance,
      problemDescription: row.problem_description,
      concernLevelCode: row.concern_level_code,
      concernLevelLabel: row.concern_level_label,
      authorDisplayName: row.author_display_name,
      commentedAt: new Date(row.commented_at).toISOString(),
    };
  }

  private toReportRow(row: ClassroomCommentListRow): ClassroomCommentReportResponseDto {
    return {
      id: row.id,
      studentUuid: row.student_uuid,
      studentName: row.student_name,
      schoolName: row.school_name,
      gradeLabel: row.grade_label,
      roomNo: row.room_no,
      problemCategory: row.problem_category_code,
      problemCategoryLabel: row.problem_category_label,
      problemCategoryGuidance: row.problem_category_guidance,
      problemDescription: row.problem_description,
      concernLevelCode: row.concern_level_code,
      concernLevelLabel: row.concern_level_label,
      authorDisplayName: row.author_display_name,
      commentedAt: new Date(row.commented_at).toISOString(),
    };
  }

  /** The latest comments shown on one student's profile. */
  async listStudentComments(studentTermId: string, actor: AuthenticatedRequestUser) {
    const scope = this.readerScope(actor);
    const rows = await this.repository.listStudentClassroomComments(scope, studentTermId, 3);
    const data = rows.map((row) => this.toStudentComment(row));
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
  async listComments(
    query: { page?: number; limit?: number; searchTerm?: string },
    actor: AuthenticatedRequestUser,
  ) {
    const scope = this.readerScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listClassroomComments(scope, {
      page,
      limit,
      searchTerm: query.searchTerm,
    });
    const totalCount = Number(rows[0]?.total_count ?? 0);
    return {
      data: rows.map((row) => this.toReportRow(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }
}
