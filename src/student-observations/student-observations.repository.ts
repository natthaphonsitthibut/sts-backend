import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  ObservationAssignmentRow,
  ObservationBehaviorTagRow,
  ObservationDimensionRow,
  ObservationEnrollmentRow,
  ObservationWriteInput,
  StudentObservationRevisionRow,
  StudentObservationRow,
} from './student-observations.types';

interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

@Injectable()
export class StudentObservationsRepository {
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

  async isEnrollmentInScope(studentUuid: string, scope: DataScope): Promise<boolean> {
    const scoped = buildDataScopeQuery(
      scope,
      {
        school_id: 'enrollment."SchoolID_Onec"',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'enrollment."GradeLevelID_Onec"',
        room: 'enrollment."RoomID_Onec"::text',
      },
      2,
    );
    const result = await queryDataSource(
      this.dataSource,
      `
        SELECT 1
        FROM student_term enrollment
        JOIN schools school ON school.id = enrollment."SchoolID_Onec"
        WHERE enrollment.student_uuid = $1
          AND enrollment.deleted_at IS NULL
          AND school.school_status = 'ACTIVE'
          AND ${scoped.sql || 'TRUE'}
        LIMIT 1
      `,
      [studentUuid, ...scoped.params],
    );
    return result.rows.length > 0;
  }

  async findEnrollment(
    studentUuid: string,
    queryRunner?: QueryRunner,
  ): Promise<ObservationEnrollmentRow | null> {
    const result = await this.executor(queryRunner).query<ObservationEnrollmentRow>(
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment."SchoolID_Onec" AS school_id,
          enrollment."GradeLevelID_Onec" AS grade_level_id,
          enrollment."RoomID_Onec" AS room_id,
          school.name AS school_name,
          school.school_status,
          term.id::text AS school_term_id,
          enrollment."AcademicYear_Onec" AS academic_year,
          enrollment."Semester_Onec" AS semester,
          term.status AS term_status,
          term.starts_on::text AS term_starts_on,
          term.ends_on::text AS term_ends_on,
          classroom.id::text AS classroom_id,
          classroom.classroom_status
        FROM student_term enrollment
        JOIN schools school ON school.id = enrollment."SchoolID_Onec"
        JOIN school_terms term
          ON term.school_id = enrollment."SchoolID_Onec"
         AND term.academic_year = enrollment."AcademicYear_Onec"
         AND term.semester = enrollment."Semester_Onec"
         AND term.deleted_at IS NULL
        LEFT JOIN school_classrooms classroom
          ON classroom.id = enrollment.classroom_id
         AND classroom.school_term_id = term.id
         AND classroom.deleted_at IS NULL
        WHERE enrollment.student_uuid = $1
          AND enrollment.deleted_at IS NULL
        LIMIT 1
      `,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async isTimetableSlotForEnrollment(
    timetableSlotId: number,
    enrollment: ObservationEnrollmentRow,
    queryRunner?: QueryRunner,
  ): Promise<boolean> {
    if (!enrollment.classroom_id) {
      return false;
    }
    const result = await this.executor(queryRunner).query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM timetable_slots slot
         WHERE slot.id = $1
           AND slot.school_id = $2
           AND slot.classroom_id = $3
           AND slot.deleted_at IS NULL
       ) AS found`,
      [timetableSlotId, enrollment.school_id, enrollment.classroom_id],
    );
    return result.rows[0]?.found === true;
  }

  async findActiveAssignment(
    assignmentId: number,
    studentUuid: string,
    onDate: string,
    queryRunner?: QueryRunner,
  ): Promise<ObservationAssignmentRow | null> {
    const result = await this.executor(queryRunner).query<ObservationAssignmentRow>(
      `
        SELECT
          assignment.id::text AS assignment_id,
          assignment.teacher_membership_id::text,
          membership.teacher_user_id,
          assignment.school_id,
          classroom.school_term_id::text,
          assignment.classroom_id::text,
          assignment.subject_id,
          assignment.assignment_kind
        FROM classroom_teacher_assignments assignment
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
         AND membership.school_id = assignment.school_id
        JOIN school_classrooms classroom
          ON classroom.id = assignment.classroom_id
         AND classroom.school_id = assignment.school_id
        JOIN student_term enrollment
          ON enrollment.classroom_id = classroom.id
         AND enrollment.student_uuid = $2
         AND enrollment.deleted_at IS NULL
        JOIN school_terms term ON term.id = classroom.school_term_id
        JOIN schools school ON school.id = assignment.school_id
        JOIN users teacher ON teacher.id = membership.teacher_user_id
        WHERE assignment.id = $1
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher.status = 'ACTIVE'
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND school.school_status = 'ACTIVE'
          AND term.status = 'ACTIVE'
          AND term.deleted_at IS NULL
          AND ($3::date >= COALESCE(assignment.effective_on, $3::date))
          AND ($3::date <= COALESCE(assignment.effective_until, $3::date))
          AND ($3::date >= COALESCE(membership.started_on, $3::date))
          AND ($3::date <= COALESCE(membership.ended_on, $3::date))
          AND ($3::date >= COALESCE(term.starts_on, $3::date))
          AND ($3::date <= COALESCE(term.ends_on, $3::date))
        LIMIT 1
      `,
      [assignmentId, studentUuid, onDate],
    );
    return result.rows[0] ?? null;
  }

  async findActorAssignment(
    actorUserId: number,
    studentUuid: string,
    onDate: string,
    queryRunner?: QueryRunner,
  ): Promise<ObservationAssignmentRow | null> {
    const result = await this.executor(queryRunner).query<{ id: number }>(
      `
        SELECT assignment.id
        FROM classroom_teacher_assignments assignment
        JOIN school_teacher_memberships membership
          ON membership.id = assignment.teacher_membership_id
         AND membership.school_id = assignment.school_id
        JOIN student_term enrollment
          ON enrollment.classroom_id = assignment.classroom_id
         AND enrollment.student_uuid = $2
         AND enrollment.deleted_at IS NULL
        WHERE membership.teacher_user_id = $1
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND ($3::date >= COALESCE(assignment.effective_on, $3::date))
          AND ($3::date <= COALESCE(assignment.effective_until, $3::date))
          AND ($3::date >= COALESCE(membership.started_on, $3::date))
          AND ($3::date <= COALESCE(membership.ended_on, $3::date))
        ORDER BY assignment.id
        LIMIT 1
      `,
      [actorUserId, studentUuid, onDate],
    );
    const assignmentId = result.rows[0]?.id;
    return assignmentId
      ? await this.findActiveAssignment(assignmentId, studentUuid, onDate, queryRunner)
      : null;
  }

  async findActorAssignmentForTimetableSlot(
    actorUserId: number,
    studentUuid: string,
    timetableSlotId: number,
    onDate: string,
    queryRunner?: QueryRunner,
  ): Promise<ObservationAssignmentRow | null> {
    const result = await this.executor(queryRunner).query<{ assignment_id: number }>(
      `SELECT assignment.id AS assignment_id
       FROM timetable_slots slot
       JOIN student_term enrollment
         ON enrollment.classroom_id = slot.classroom_id
        AND enrollment.student_uuid = $2
        AND enrollment.deleted_at IS NULL
       JOIN classroom_teacher_assignments assignment
         ON assignment.classroom_id = slot.classroom_id
        AND assignment.school_id = slot.school_id
        AND assignment.subject_id = slot.subject_id
        AND assignment.assignment_status = 'ACTIVE'
        AND assignment.deleted_at IS NULL
       JOIN school_teacher_memberships membership
         ON membership.id = assignment.teacher_membership_id
        AND membership.teacher_user_id = $1
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
       WHERE slot.id = $3
         AND slot.deleted_at IS NULL
         AND slot.teacher_user_id = $1
         AND ($4::date >= COALESCE(assignment.effective_on, $4::date))
         AND ($4::date <= COALESCE(assignment.effective_until, $4::date))
       LIMIT 1`,
      [actorUserId, studentUuid, timetableSlotId, onDate],
    );
    const assignmentId = result.rows[0]?.assignment_id;
    return assignmentId
      ? await this.findActiveAssignment(assignmentId, studentUuid, onDate, queryRunner)
      : null;
  }

  async resolveCatalog(
    dimensionCode: string,
    tagCodes: string[],
    queryRunner?: QueryRunner,
  ): Promise<{ dimension: ObservationDimensionRow | null; tags: ObservationBehaviorTagRow[] }> {
    const dimensionResult = await this.executor(queryRunner).query<ObservationDimensionRow>(
      `
        SELECT id::text, code, label_th, requires_comment, is_active, sort_order
        FROM observation_dimensions
        WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
        LIMIT 1
      `,
      [dimensionCode],
    );
    const tagResult = tagCodes.length
      ? await this.executor(queryRunner).query<ObservationBehaviorTagRow>(
          `
            SELECT tag.id::text, tag.code, tag.label_th,
                   tag.observation_dimension_id::text,
                   dimension.code AS dimension_code,
                   tag.requires_comment, tag.is_active, tag.sort_order
            FROM observation_behavior_tags tag
            LEFT JOIN observation_dimensions dimension
              ON dimension.id = tag.observation_dimension_id
            WHERE tag.code = ANY($1::text[])
              AND tag.is_active = TRUE
              AND tag.deleted_at IS NULL
            ORDER BY tag.sort_order, tag.id
          `,
          [tagCodes],
        )
      : { rows: [] as ObservationBehaviorTagRow[] };
    return { dimension: dimensionResult.rows[0] ?? null, tags: tagResult.rows };
  }

  async listCatalog(queryRunner?: QueryRunner): Promise<{
    dimensions: ObservationDimensionRow[];
    tags: ObservationBehaviorTagRow[];
  }> {
    const dimensions = await this.executor(queryRunner).query<ObservationDimensionRow>(
      `SELECT id::text, code, label_th, requires_comment, is_active, sort_order
       FROM observation_dimensions WHERE deleted_at IS NULL ORDER BY sort_order, id`,
    );
    const tags = await this.executor(queryRunner).query<ObservationBehaviorTagRow>(
      `SELECT tag.id::text, tag.code, tag.label_th, tag.observation_dimension_id::text,
              dimension.code AS dimension_code, tag.requires_comment, tag.is_active, tag.sort_order
       FROM observation_behavior_tags tag
       LEFT JOIN observation_dimensions dimension ON dimension.id = tag.observation_dimension_id
       WHERE tag.deleted_at IS NULL ORDER BY tag.sort_order, tag.id`,
    );
    return { dimensions: dimensions.rows, tags: tags.rows };
  }

  private observationSelectSql(): string {
    return `
      SELECT
        observation.id::text,
        observation.student_uuid::text,
        observation.school_id,
        CASE WHEN observation.source_task_link_id IS NOT NULL
          THEN 'TASK_LINK' ELSE observation.author_kind END AS author_kind,
        observation.author_user_id,
        COALESCE(observation.observer_display_name, author.username) AS author_username,
        COALESCE(
          observation.observer_display_name,
          NULLIF(trim(concat_ws(' ', author."FirstName", author."LastName")), ''),
          author.username
        )
          AS author_display_name,
        observation.author_teacher_membership_id::text,
        observation.source_teacher_access_grant_id::text,
        observation.source_assignment_id::text,
        observation.source_task_link_id::text,
        observation.source_timetable_slot_id::text,
        COALESCE(assignment.subject_id, timetable_slot.subject_id) AS subject_id,
        subject.code AS subject_code,
        subject.name_th AS subject_name,
        observation.observation_dimension_id::text,
        dimension.code AS dimension_code,
        dimension.label_th AS dimension_label,
        observation.concern_level,
        observation.comment,
        observation.comment_required,
        observation.observed_at,
        observation.revision_number,
        observation.created_at,
        observation.updated_at,
        COALESCE(tag_list.tags, '[]'::jsonb) AS tags
      FROM student_observations observation
      JOIN users author ON author.id = observation.author_user_id
      JOIN observation_dimensions dimension ON dimension.id = observation.observation_dimension_id
      LEFT JOIN classroom_teacher_assignments assignment
        ON assignment.id = observation.source_assignment_id
      LEFT JOIN timetable_slots timetable_slot
        ON timetable_slot.id = observation.source_timetable_slot_id
      LEFT JOIN subjects subject
        ON subject.id = COALESCE(assignment.subject_id, timetable_slot.subject_id)
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object('id', tag.id::text, 'code', tag.code, 'labelTh', tag.label_th)
          ORDER BY tag.sort_order, tag.id
        ) AS tags
        FROM student_observation_tags link
        JOIN observation_behavior_tags tag ON tag.id = link.behavior_tag_id
        WHERE link.observation_id = observation.id
      ) tag_list ON TRUE
      WHERE observation.deleted_at IS NULL
    `;
  }

  async createObservation(
    input: ObservationWriteInput,
    queryRunner: QueryRunner,
  ): Promise<StudentObservationRow> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `
        INSERT INTO student_observations (
          student_uuid, school_id, author_kind, author_user_id,
          author_teacher_membership_id, source_teacher_access_grant_id, source_assignment_id,
          source_task_link_id, source_timetable_slot_id, observer_display_name,
          observation_dimension_id, concern_level, comment, comment_required, observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING id::text
      `,
      [
        input.studentUuid,
        input.schoolId,
        input.authorKind,
        input.authorUserId,
        input.authorTeacherMembershipId,
        input.sourceTeacherAccessGrantId,
        input.sourceAssignmentId,
        input.sourceTaskLinkId,
        input.sourceTimetableSlotId,
        input.observerDisplayName,
        input.dimensionId,
        input.concernLevel,
        input.comment,
        input.commentRequired,
        input.observedAt,
      ],
    );
    const observationId = result.rows[0].id;
    await this.replaceTags(observationId, input.behaviorTagIds, queryRunner);
    await this.insertRevision(observationId, 1, input, input.authorUserId, queryRunner);
    return (await this.findObservationById(input.studentUuid, observationId, queryRunner))!;
  }

  async findObservationById(
    studentUuid: string,
    observationId: string,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<StudentObservationRow | null> {
    const result = await this.executor(queryRunner).query<StudentObservationRow>(
      `${this.observationSelectSql()}
       AND observation.student_uuid = $1 AND observation.id = $2
       ${lock ? 'FOR UPDATE OF observation' : ''}`,
      [studentUuid, observationId],
    );
    return result.rows[0] ?? null;
  }

  async listObservations(
    studentUuid: string,
    filters: {
      concernLevel?: string;
      dimensionCode?: string;
      page: number;
      limit: number;
    },
    queryRunner?: QueryRunner,
  ): Promise<StudentObservationRow[]> {
    const result = await this.executor(queryRunner).query<StudentObservationRow>(
      `
        SELECT selected.*, COUNT(*) OVER()::int AS total_count
        FROM (${this.observationSelectSql()}) selected
        WHERE selected.student_uuid = $1
          AND ($2::text IS NULL OR selected.concern_level = $2)
          AND ($3::text IS NULL OR selected.dimension_code = $3)
        ORDER BY selected.observed_at DESC, selected.id DESC
        LIMIT $4 OFFSET $5
      `,
      [
        studentUuid,
        filters.concernLevel ?? null,
        filters.dimensionCode ?? null,
        filters.limit,
        (filters.page - 1) * filters.limit,
      ],
    );
    return result.rows;
  }

  async listTaskLinkObservations(
    studentUuid: string,
    taskLinkId: string,
    timetableSlotId: number | null,
    page: number,
    limit: number,
    queryRunner?: QueryRunner,
  ): Promise<StudentObservationRow[]> {
    const result = await this.executor(queryRunner).query<StudentObservationRow>(
      `SELECT selected.*, COUNT(*) OVER()::int AS total_count
       FROM (${this.observationSelectSql()}) selected
       WHERE selected.student_uuid = $1
         AND selected.source_task_link_id = $2
         AND ($3::bigint IS NULL OR selected.source_timetable_slot_id = $3::bigint)
       ORDER BY selected.observed_at DESC, selected.id DESC
       LIMIT $4 OFFSET $5`,
      [studentUuid, taskLinkId, timetableSlotId, limit, (page - 1) * limit],
    );
    return result.rows;
  }

  async updateObservation(
    observationId: string,
    next: ObservationWriteInput,
    nextRevision: number,
    changedByUserId: number,
    queryRunner: QueryRunner,
  ): Promise<StudentObservationRow> {
    await this.executor(queryRunner).query(
      `
        UPDATE student_observations
        SET observation_dimension_id = $2,
            concern_level = $3,
            comment = $4,
            comment_required = $5,
            observed_at = $6,
            revision_number = $7,
            updated_at = now()
        WHERE id = $1
      `,
      [
        observationId,
        next.dimensionId,
        next.concernLevel,
        next.comment,
        next.commentRequired,
        next.observedAt,
        nextRevision,
      ],
    );
    await this.replaceTags(observationId, next.behaviorTagIds, queryRunner);
    await this.insertRevision(observationId, nextRevision, next, changedByUserId, queryRunner);
    return (await this.findObservationById(next.studentUuid, observationId, queryRunner))!;
  }

  private async replaceTags(
    observationId: string,
    tagIds: number[],
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `DELETE FROM student_observation_tags WHERE observation_id = $1`,
      [observationId],
    );
    if (tagIds.length > 0) {
      await this.executor(queryRunner).query(
        `
          INSERT INTO student_observation_tags (observation_id, behavior_tag_id)
          SELECT $1, unnest($2::bigint[])
        `,
        [observationId, tagIds],
      );
    }
  }

  private async insertRevision(
    observationId: string,
    revision: number,
    input: ObservationWriteInput,
    changedByUserId: number,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        INSERT INTO student_observation_revisions (
          observation_id, revision_number, observation_dimension_id, concern_level,
          comment, comment_required, observed_at, behavior_tag_ids,
          changed_by_user_id, source_teacher_access_grant_id, change_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
      `,
      [
        observationId,
        revision,
        input.dimensionId,
        input.concernLevel,
        input.comment,
        input.commentRequired,
        input.observedAt,
        JSON.stringify(input.behaviorTagIds.map(String)),
        changedByUserId,
        input.sourceTeacherAccessGrantId,
        input.changeReason ?? null,
      ],
    );
  }

  async listRevisions(
    observationId: string,
    page: number,
    limit: number,
    queryRunner?: QueryRunner,
  ): Promise<StudentObservationRevisionRow[]> {
    const result = await this.executor(queryRunner).query<StudentObservationRevisionRow>(
      `
        SELECT revision.id::text, revision.observation_id::text, revision.revision_number,
               dimension.code AS dimension_code, dimension.label_th AS dimension_label,
               revision.concern_level, revision.comment, revision.comment_required,
               revision.observed_at, revision.behavior_tag_ids,
               revision.changed_by_user_id,
               COALESCE(NULLIF(trim(concat_ws(' ', actor."FirstName", actor."LastName")), ''), actor.username)
                 AS changed_by_display_name,
               revision.source_teacher_access_grant_id::text,
               revision.change_reason, revision.changed_at,
               COUNT(*) OVER()::int AS total_count
        FROM student_observation_revisions revision
        JOIN observation_dimensions dimension ON dimension.id = revision.observation_dimension_id
        JOIN users actor ON actor.id = revision.changed_by_user_id
        WHERE revision.observation_id = $1
        ORDER BY revision.revision_number DESC
        LIMIT $2 OFFSET $3
      `,
      [observationId, limit, (page - 1) * limit],
    );
    return result.rows;
  }

  async updateDimension(
    id: number,
    patch: { labelTh?: string; requiresComment?: boolean; isActive?: boolean; sortOrder?: number },
    actorId: number,
    queryRunner: QueryRunner,
  ): Promise<ObservationDimensionRow | null> {
    const result = await this.executor(queryRunner).query<ObservationDimensionRow>(
      `
        UPDATE observation_dimensions
        SET label_th = COALESCE($2, label_th),
            requires_comment = COALESCE($3, requires_comment),
            is_active = COALESCE($4, is_active),
            sort_order = COALESCE($5, sort_order),
            updated_by = $6,
            updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id::text, code, label_th, requires_comment, is_active, sort_order
      `,
      [
        id,
        patch.labelTh ?? null,
        patch.requiresComment ?? null,
        patch.isActive ?? null,
        patch.sortOrder ?? null,
        actorId,
      ],
    );
    return result.rows[0] ?? null;
  }

  async updateTag(
    id: number,
    patch: { labelTh?: string; requiresComment?: boolean; isActive?: boolean; sortOrder?: number },
    actorId: number,
    queryRunner: QueryRunner,
  ): Promise<ObservationBehaviorTagRow | null> {
    const result = await this.executor(queryRunner).query<ObservationBehaviorTagRow>(
      `
        WITH updated AS (
          UPDATE observation_behavior_tags
          SET label_th = COALESCE($2, label_th),
              requires_comment = COALESCE($3, requires_comment),
              is_active = COALESCE($4, is_active),
              sort_order = COALESCE($5, sort_order),
              updated_by = $6,
              updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING *
        )
        SELECT updated.id::text, updated.code, updated.label_th,
               updated.observation_dimension_id::text,
               dimension.code AS dimension_code,
               updated.requires_comment, updated.is_active, updated.sort_order
        FROM updated
        LEFT JOIN observation_dimensions dimension
          ON dimension.id = updated.observation_dimension_id
      `,
      [
        id,
        patch.labelTh ?? null,
        patch.requiresComment ?? null,
        patch.isActive ?? null,
        patch.sortOrder ?? null,
        actorId,
      ],
    );
    return result.rows[0] ?? null;
  }
}
