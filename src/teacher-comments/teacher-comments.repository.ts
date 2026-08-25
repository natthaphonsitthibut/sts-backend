import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import type { ClassroomCommentListRow, StudentClassroomCommentRow } from './teacher-comments.types';

@Injectable()
export class TeacherCommentsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listStudentClassroomComments(
    scope: DataScope,
    studentTermId: string,
    limit: number,
  ): Promise<StudentClassroomCommentRow[]> {
    const params: unknown[] = [studentTermId];
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'enrollment."GradeLevelID_Onec"',
        room: 'enrollment.classroom_id',
      },
      2,
    );
    params.push(...scoped.params);
    params.push(limit);
    const limitIndex = params.length;
    const scopeCondition = scoped.sql ? `AND (${scoped.sql})` : '';

    const result = await queryDataSource<StudentClassroomCommentRow>(
      this.dataSource,
      `SELECT
         comment.id::text,
         enrollment.student_uuid::text,
         comment.problem_category_code,
         problem_category.label_th AS problem_category_label,
         problem_category.guidance_th AS problem_category_guidance,
         comment.problem_description,
         comment.concern_level_code,
         concern_level.label_th AS concern_level_label,
         COALESCE(
           NULLIF(trim(concat_ws(' ', author_teacher.first_name, author_teacher.last_name)), ''),
           NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
           author.username,
           comment.authored_by_display_name
         ) AS author_display_name,
         comment.created_at AS commented_at,
         COUNT(*) OVER()::int AS total_count
       FROM classroom_student_comments comment
       JOIN student_term enrollment
         ON enrollment.person_uuid = comment.person_uuid
        AND enrollment.classroom_id = comment.classroom_id
       JOIN student_current_enrollment_resolution current_enrollment
         ON current_enrollment.person_uuid = enrollment.person_uuid
        AND current_enrollment.selected_student_uuid = enrollment.student_uuid
        AND current_enrollment.resolution_state = 'ACTIVE'
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       LEFT JOIN users author ON author.id = comment.authored_by_user_id
       LEFT JOIN teachers author_teacher ON author_teacher.id = comment.authored_by_teacher_id
       JOIN classroom_student_problem_categories problem_category
         ON problem_category.code = comment.problem_category_code
       JOIN classroom_student_comment_concern_levels concern_level
         ON concern_level.code = comment.concern_level_code
       WHERE enrollment.student_uuid = $1
         AND enrollment.deleted_at IS NULL
         ${scopeCondition}
       ORDER BY comment.created_at DESC, comment.id DESC
       LIMIT $${limitIndex}`,
      params,
    );
    return result.rows;
  }

  /**
   * All teacher comments the actor may see — the list behind หน้าความคิดเห็นจาก
   * คุณครู. Same scope columns as the per-student read, one row per comment.
   */
  async listClassroomComments(
    scope: DataScope,
    filters: { page: number; limit: number; searchTerm?: string },
  ): Promise<ClassroomCommentListRow[]> {
    const params: unknown[] = [];
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'enrollment."GradeLevelID_Onec"',
        room: 'enrollment.classroom_id',
      },
      1,
    );
    params.push(...scoped.params);
    const conditions = ['enrollment.deleted_at IS NULL'];
    if (scoped.sql) conditions.push(`(${scoped.sql})`);
    if (filters.searchTerm) {
      params.push(`%${escapeLikePattern(filters.searchTerm)}%`);
      const searchIndex = params.length;
      conditions.push(
        `(CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec") ILIKE $${searchIndex} ESCAPE '\\'
          OR comment.problem_description ILIKE $${searchIndex} ESCAPE '\\')`,
      );
    }
    params.push(filters.limit);
    const limitIndex = params.length;
    params.push((filters.page - 1) * filters.limit);
    const offsetIndex = params.length;

    const result = await queryDataSource<ClassroomCommentListRow>(
      this.dataSource,
      `SELECT
         comment.id::text,
         enrollment.student_uuid::text,
         TRIM(CONCAT_WS(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec")) AS student_name,
         school.name AS school_name,
         grade.label AS grade_label,
         enrollment."RoomID_Onec"::text AS room_no,
         comment.problem_category_code,
         problem_category.label_th AS problem_category_label,
         problem_category.guidance_th AS problem_category_guidance,
         comment.problem_description,
         comment.concern_level_code,
         concern_level.label_th AS concern_level_label,
         COALESCE(
           NULLIF(trim(concat_ws(' ', author_teacher.first_name, author_teacher.last_name)), ''),
           NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
           author.username,
           comment.authored_by_display_name
         ) AS author_display_name,
         comment.created_at AS commented_at,
         COUNT(*) OVER()::int AS total_count
       FROM classroom_student_comments comment
       JOIN student_term enrollment
         ON enrollment.person_uuid = comment.person_uuid
        AND enrollment.classroom_id = comment.classroom_id
       JOIN student_current_enrollment_resolution current_enrollment
         ON current_enrollment.person_uuid = enrollment.person_uuid
        AND current_enrollment.selected_student_uuid = enrollment.student_uuid
        AND current_enrollment.resolution_state = 'ACTIVE'
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       LEFT JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
       LEFT JOIN users author ON author.id = comment.authored_by_user_id
       LEFT JOIN teachers author_teacher ON author_teacher.id = comment.authored_by_teacher_id
       JOIN classroom_student_problem_categories problem_category
         ON problem_category.code = comment.problem_category_code
       JOIN classroom_student_comment_concern_levels concern_level
         ON concern_level.code = comment.concern_level_code
       WHERE ${conditions.join(' AND ')}
       ORDER BY comment.created_at DESC, comment.id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );
    return result.rows;
  }
}
