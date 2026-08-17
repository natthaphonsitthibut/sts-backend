import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern } from '../common/utils/helpers';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ClassroomCommentListRow,
  HumanRiskDecision,
  ObservationReviewEnrollmentRow,
  ObservationSourceRef,
  RiskReviewRow,
  StudentClassroomCommentRow,
  TeacherObservationReportRow,
  TeacherWatchlistRow,
  ValidatedObservationSourceRow,
} from './observation-reviews.types';

interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

@Injectable()
export class ObservationReviewsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private executor(queryRunner?: QueryRunner): QueryExecutor {
    return queryRunner
      ? createSqlQueryExecutor(queryRunner)
      : {
          query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
            await queryDataSource<T>(this.dataSource, sql, params),
        };
  }

  async isSchoolInScope(
    schoolId: number,
    scope: DataScope,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      2,
    );
    const result = await this.executor(queryRunner).query(
      `SELECT 1 FROM schools school
       WHERE school.id = $1
         AND school.school_status = 'ACTIVE'
         AND ${scoped.sql || 'TRUE'}
       LIMIT 1`,
      [schoolId, ...scoped.params],
    );
    return result.rows.length > 0;
  }

  async lockEnrollment(
    studentUuid: string,
    queryRunner: QueryRunner,
  ): Promise<ObservationReviewEnrollmentRow | null> {
    const result = await this.executor(queryRunner).query<ObservationReviewEnrollmentRow>(
      `SELECT enrollment.student_uuid::text,
              enrollment."SchoolID_Onec" AS school_id,
              term.id::text AS school_term_id,
              enrollment.classroom_id::text
       FROM student_term enrollment
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       JOIN school_terms term
         ON term.school_id = enrollment."SchoolID_Onec"
        AND term.academic_year = enrollment."AcademicYear_Onec"
        AND term.semester = enrollment."Semester_Onec"
        AND term.deleted_at IS NULL
       WHERE enrollment.student_uuid = $1
         AND enrollment.deleted_at IS NULL
         AND school.school_status = 'ACTIVE'
       LIMIT 1
       FOR UPDATE OF enrollment`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async findEnrollment(studentUuid: string): Promise<ObservationReviewEnrollmentRow | null> {
    const result = await queryDataSource<ObservationReviewEnrollmentRow>(
      this.dataSource,
      `SELECT enrollment.student_uuid::text,
              enrollment."SchoolID_Onec" AS school_id,
              term.id::text AS school_term_id,
              enrollment.classroom_id::text
       FROM student_term enrollment
       JOIN schools school ON school.id = enrollment."SchoolID_Onec"
       JOIN school_terms term
         ON term.school_id = enrollment."SchoolID_Onec"
        AND term.academic_year = enrollment."AcademicYear_Onec"
        AND term.semester = enrollment."Semester_Onec"
        AND term.deleted_at IS NULL
       WHERE enrollment.student_uuid = $1
         AND enrollment.deleted_at IS NULL
         AND school.school_status = 'ACTIVE'
       LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async validateObservationSources(
    studentUuid: string,
    sources: ObservationSourceRef[],
    queryRunner: QueryRunner,
  ): Promise<ValidatedObservationSourceRow[]> {
    const result = await this.executor(queryRunner).query<ValidatedObservationSourceRow>(
      `WITH requested AS (
         SELECT *
         FROM unnest($2::bigint[], $3::integer[])
           AS source(observation_id, observation_revision)
       )
       SELECT source.observation_id,
              source.observation_revision,
              revision.concern_level
       FROM requested source
       JOIN student_observations observation
         ON observation.id = source.observation_id
        AND observation.student_uuid = $1
        AND observation.deleted_at IS NULL
       JOIN student_observation_revisions revision
         ON revision.observation_id = source.observation_id
        AND revision.revision_number = source.observation_revision`,
      [
        studentUuid,
        sources.map((source) => source.observationId),
        sources.map((source) => source.revision),
      ],
    );
    return result.rows;
  }

  async findCalculatedAttendanceRisk(
    studentUuid: string,
    queryRunner?: QueryRunner,
  ): Promise<string> {
    const result = await this.executor(queryRunner).query<{ risk_tier: string }>(
      `SELECT COALESCE(profile.risk_tier, 'UNKNOWN') AS risk_tier
       FROM student_term enrollment
       LEFT JOIN student_risk_profiles profile ON profile.student_uuid = enrollment.student_uuid
       WHERE enrollment.student_uuid = $1
         AND enrollment.deleted_at IS NULL
       LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0]?.risk_tier ?? 'UNKNOWN';
  }

  private riskReviewSelectSql(): string {
    return `SELECT review.id,
                   review.student_uuid::text,
                   review.school_id,
                   review.calculated_attendance_risk,
                   review.teacher_concern_signal,
                   review.human_risk_decision,
                   review.decision_reason,
                   review.decided_by,
                   actor.username AS decided_by_username,
                   review.decided_at,
                   review.revision_number,
                   COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                       'observationId', source.observation_id,
                       'revision', source.observation_revision
                     ) ORDER BY source.observation_id)
                     FROM student_observation_risk_review_sources source
                     WHERE source.risk_review_id = review.id
                   ), '[]'::jsonb) AS sources
            FROM student_observation_risk_reviews review
            JOIN users actor ON actor.id = review.decided_by`;
  }

  async findLatestRiskReview(
    studentUuid: string,
    queryRunner?: QueryRunner,
  ): Promise<RiskReviewRow | null> {
    const result = await this.executor(queryRunner).query<RiskReviewRow>(
      `${this.riskReviewSelectSql()}
       WHERE review.student_uuid = $1
       ORDER BY review.revision_number DESC
       LIMIT 1`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async insertRiskReview(
    input: {
      studentUuid: string;
      schoolId: number;
      calculatedAttendanceRisk: string;
      teacherConcernSignal: 'NONE' | 'WATCH' | 'CONCERN';
      humanRiskDecision: HumanRiskDecision;
      decisionReason: string;
      decidedBy: number;
      revision: number;
      sources: ObservationSourceRef[];
    },
    queryRunner: QueryRunner,
  ): Promise<RiskReviewRow> {
    const inserted = await this.executor(queryRunner).query<{ id: string }>(
      `INSERT INTO student_observation_risk_reviews (
         student_uuid, school_id, calculated_attendance_risk, teacher_concern_signal,
         human_risk_decision, decision_reason, decided_by, revision_number
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.studentUuid,
        input.schoolId,
        input.calculatedAttendanceRisk,
        input.teacherConcernSignal,
        input.humanRiskDecision,
        input.decisionReason,
        input.decidedBy,
        input.revision,
      ],
    );
    const id = inserted.rows[0].id;
    if (input.sources.length > 0) {
      await this.executor(queryRunner).query(
        `INSERT INTO student_observation_risk_review_sources (
           risk_review_id, observation_id, observation_revision
         )
         SELECT $1, source.observation_id, source.observation_revision
         FROM unnest($2::bigint[], $3::integer[])
           AS source(observation_id, observation_revision)`,
        [
          id,
          input.sources.map((source) => source.observationId),
          input.sources.map((source) => source.revision),
        ],
      );
    }
    return (await this.findLatestRiskReview(input.studentUuid, queryRunner))!;
  }

  async listTeacherObservationReports(
    scope: DataScope,
    filters: {
      concernLevel?: string;
      schoolId?: number;
      gradeLevelId?: number;
      roomId?: string;
      searchTerm?: string;
      observationId?: string;
      sortBy?: 'studentName' | 'dimension' | 'concernLevel' | 'comment' | 'author';
      sortDirection?: 'asc' | 'desc';
      page: number;
      limit: number;
    },
  ): Promise<TeacherObservationReportRow[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    const push = (value: unknown): number => {
      params.push(value);
      return params.length;
    };

    if (filters.concernLevel) {
      conditions.push(`report.concern_level = $${push(filters.concernLevel)}`);
    }
    if (filters.schoolId) {
      conditions.push(`report.school_id = $${push(filters.schoolId)}`);
    }
    if (filters.gradeLevelId) {
      conditions.push(`report.grade_level_id = $${push(filters.gradeLevelId)}`);
    }
    if (filters.roomId) {
      conditions.push(`report.classroom_id = $${push(filters.roomId)}::uuid`);
    }
    if (filters.searchTerm) {
      const searchIndex = push(`%${filters.searchTerm}%`);
      conditions.push(
        `(report.student_name ILIKE $${searchIndex} OR report.report_id ILIKE $${searchIndex})`,
      );
    }
    if (filters.observationId) {
      conditions.push(`report.observation_id = $${push(filters.observationId)}`);
    }
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'report.school_id',
        province: 'report.province',
        district: 'report.district',
        sub_district: 'report.sub_district',
        grade: 'report.grade_level_id',
        room: 'report.classroom_id',
      },
      params.length + 1,
    );
    if (scoped.sql) conditions.push(`(${scoped.sql})`);
    params.push(...scoped.params);
    const limitIndex = push(filters.limit);
    const offsetIndex = push((filters.page - 1) * filters.limit);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumns = {
      studentName: 'report.student_name',
      dimension: 'report.dimension_label',
      concernLevel:
        "CASE report.concern_level WHEN 'CONCERN' THEN 0 WHEN 'WATCH' THEN 1 ELSE 2 END",
      comment: 'report.comment',
      author: 'report.author_display_name',
    } as const;
    const direction = filters.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const orderBy = filters.sortBy
      ? `${sortColumns[filters.sortBy]} ${direction} NULLS LAST,
         report.observed_at DESC,
         report.report_id DESC`
      : `CASE report.concern_level WHEN 'CONCERN' THEN 0 WHEN 'WATCH' THEN 1 ELSE 2 END,
         report.observed_at DESC,
         report.report_id DESC`;

    const result = await queryDataSource<TeacherObservationReportRow>(
      this.dataSource,
      `WITH reports AS (
         SELECT
           'OBSERVATION'::text AS report_kind,
           observation.id::text AS report_id,
           observation.id::text AS observation_id,
           observation.revision_number AS observation_revision,
           observation.student_uuid::text,
           trim(concat_ws(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec"))
             AS student_name,
           observation.school_id,
           school.name AS school_name,
           school.province,
           school.district,
           school.sub_district,
           enrollment."GradeLevelID_Onec" AS grade_level_id,
           grade.label AS grade_label,
           enrollment.classroom_id::text,
           enrollment."RoomID_Onec" AS room_no,
           COALESCE(
             observation.observer_display_name,
             NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
             author.username
           ) AS author_display_name,
           dimension.label_th AS dimension_label,
           observation.concern_level,
           observation.comment,
           observation.observed_at
         FROM student_observations observation
         LEFT JOIN users author ON author.id = observation.author_user_id
         JOIN observation_dimensions dimension
           ON dimension.id = observation.observation_dimension_id
         JOIN student_term enrollment
           ON enrollment.student_uuid = observation.student_uuid
          AND enrollment.deleted_at IS NULL
         JOIN schools school ON school.id = observation.school_id
         LEFT JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
         WHERE observation.deleted_at IS NULL
       )
       SELECT report.*, COUNT(*) OVER()::int AS total_count
       FROM reports report
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );
    return result.rows;
  }

  async listTeacherWatchlist(
    scope: DataScope,
    filters: {
      searchTerm?: string;
      province?: string;
      district?: string;
      subDistrict?: string;
      schoolId?: number;
      grade?: string;
      room?: string;
      page: number;
      limit: number;
    },
  ): Promise<TeacherWatchlistRow[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    const push = (value: unknown): number => {
      params.push(value);
      return params.length;
    };

    if (filters.searchTerm) {
      conditions.push(`watchlist.student_name ILIKE $${push(`%${filters.searchTerm}%`)}`);
    }
    if (filters.province) {
      conditions.push(`watchlist.province = $${push(filters.province)}`);
    }
    if (filters.district) {
      conditions.push(`watchlist.district = $${push(filters.district)}`);
    }
    if (filters.subDistrict) {
      conditions.push(`watchlist.sub_district = $${push(filters.subDistrict)}`);
    }
    if (filters.schoolId) {
      conditions.push(`watchlist.school_id = $${push(filters.schoolId)}`);
    }
    if (filters.grade) {
      conditions.push(`watchlist.grade_label = $${push(filters.grade)}`);
    }
    if (filters.room) {
      conditions.push(`watchlist.room_no::text = $${push(filters.room)}`);
    }

    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'watchlist.school_id',
        province: 'watchlist.province',
        district: 'watchlist.district',
        sub_district: 'watchlist.sub_district',
        grade: 'watchlist.grade_level_id',
        room: 'watchlist.classroom_id',
      },
      params.length + 1,
    );
    if (scoped.sql) conditions.push(`(${scoped.sql})`);
    params.push(...scoped.params);

    const limitIndex = push(filters.limit);
    const offsetIndex = push((filters.page - 1) * filters.limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await queryDataSource<TeacherWatchlistRow>(
      this.dataSource,
      `WITH ranked_comments AS (
         SELECT
           enrollment.student_uuid::text,
           trim(concat_ws(' ', enrollment."FirstName_Onec", enrollment."LastName_Onec"))
             AS student_name,
           enrollment."SchoolID_Onec" AS school_id,
           school.name AS school_name,
           school.province,
           school.district,
           school.sub_district,
           enrollment."GradeLevelID_Onec" AS grade_level_id,
           grade.label AS grade_label,
           enrollment.classroom_id::text,
           enrollment."RoomID_Onec" AS room_no,
           comment.id::text AS latest_comment_id,
           comment.problem_description AS latest_comment,
           COALESCE(
             NULLIF(trim(concat_ws(' ', author_teacher.first_name, author_teacher.last_name)), ''),
             NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
             author.username
           ) AS latest_author_display_name,
           comment.created_at AS latest_commented_at,
           COUNT(*) OVER (PARTITION BY comment.person_uuid)::int AS comment_count,
           ROW_NUMBER() OVER (
             PARTITION BY comment.person_uuid
             ORDER BY comment.created_at DESC, comment.id DESC
           ) AS comment_rank
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
         WHERE enrollment.deleted_at IS NULL
       ), watchlist AS (
         SELECT * FROM ranked_comments WHERE comment_rank = 1
       )
       SELECT watchlist.*, COUNT(*) OVER()::int AS total_count
       FROM watchlist
       ${where}
       ORDER BY watchlist.latest_commented_at DESC, watchlist.latest_comment_id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );
    return result.rows;
  }

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
         COALESCE(
           NULLIF(trim(concat_ws(' ', author_teacher.first_name, author_teacher.last_name)), ''),
           NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
           author.username
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
         COALESCE(
           NULLIF(trim(concat_ws(' ', author_teacher.first_name, author_teacher.last_name)), ''),
           NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
           author.username
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
       WHERE ${conditions.join(' AND ')}
       ORDER BY comment.created_at DESC, comment.id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );
    return result.rows;
  }
}
