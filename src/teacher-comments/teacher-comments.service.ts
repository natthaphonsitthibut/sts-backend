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

/**
 * The pages a teacher comment is read from. Holding any of them is what opens
 * the read — เช็กชื่อ shows the comment on its roster tab, so its permission
 * belongs here exactly as much as the student pages do. The controllers guard
 * with this same list, so the two can never disagree.
 */
export const CLASSROOM_COMMENT_READER_PERMISSIONS = [
  'students',
  'classrooms',
  'manage-school-structure',
  'attendance',
] as const;

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
    if (
      !CLASSROOM_COMMENT_READER_PERMISSIONS.some((permission) =>
        hasPermission(actor.roles, actor.permissions, permission),
      )
    ) {
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

  /**
   * The same comments, read by a teacher working from a classroom link. The
   * caller has already proved the link session owns this student's classroom,
   * which is the boundary; there is no account to resolve a scope from, so the
   * link's school stands in for it and the view is logged against the teacher.
   */
  async listStudentCommentsForLink(
    studentTermId: string,
    reader: { schoolId: number; teacherId: string; displayName: string },
  ) {
    const rows = await this.repository.listStudentClassroomComments(
      { school_ids: [reader.schoolId] },
      studentTermId,
      3,
    );
    const data = rows.map((row) => this.toStudentComment(row));
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: reader.displayName,
      action: 'STUDENT_OBSERVATION_VIEW',
      targetType: 'classroom_student_comments',
      targetId: studentTermId,
      metadata: {
        resultCount: data.length,
        totalCount: Number(rows[0]?.total_count ?? 0),
        operation: 'STUDENT_CLASSROOM_COMMENTS_VIEW',
        authoredByTeacherId: reader.teacherId,
      },
      ip: null,
    });
    return { data, meta: { totalCount: Number(rows[0]?.total_count ?? 0) } };
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
