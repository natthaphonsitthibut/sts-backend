import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type {
  FollowUpRequestRow,
  FollowUpReviewDecision,
  FollowUpUrgency,
  HumanRiskDecision,
  ObservationReviewAssignmentRow,
  ObservationReviewEnrollmentRow,
  ObservationSourceRef,
  RiskReviewRow,
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

  async findActiveAssignment(
    assignmentId: number,
    studentUuid: string,
    onDate: string,
    queryRunner: QueryRunner,
  ): Promise<ObservationReviewAssignmentRow | null> {
    const result = await this.executor(queryRunner).query<ObservationReviewAssignmentRow>(
      `SELECT assignment.id::text AS assignment_id,
              assignment.teacher_membership_id::text,
              membership.teacher_user_id,
              assignment.school_id,
              classroom.school_term_id::text,
              assignment.classroom_id::text
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
         AND term.status = 'ACTIVE'
         AND term.deleted_at IS NULL
         AND school.school_status = 'ACTIVE'
         AND ($3::date >= COALESCE(assignment.effective_on, $3::date))
         AND ($3::date <= COALESCE(assignment.effective_until, $3::date))
         AND ($3::date >= COALESCE(membership.started_on, $3::date))
         AND ($3::date <= COALESCE(membership.ended_on, $3::date))
         AND ($3::date >= COALESCE(term.starts_on, $3::date))
         AND ($3::date <= COALESCE(term.ends_on, $3::date))
       LIMIT 1`,
      [assignmentId, studentUuid, onDate],
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
    queryRunner: QueryRunner,
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
    return (await this.findLatestRiskReview(input.studentUuid, queryRunner))!;
  }

  private followUpSelectSql(includeTotalCount = false): string {
    return `SELECT request.id,
                   request.student_uuid::text,
                   request.school_id,
                   request.follow_up_request_type,
                   request.status,
                   request.urgency,
                   request.request_reason,
                   request.supplemental_note,
                   request.requested_by,
                   requester.username AS requested_by_username,
                   request.requester_teacher_membership_id::text,
                   request.source_assignment_id::text,
                   request.review_decision,
                   request.review_reason,
                   request.reviewed_by,
                   reviewer.username AS reviewed_by_username,
                   request.reviewed_at,
                   request.assigned_task_id::text,
                   request.assigned_by,
                   assignee.username AS assigned_by_username,
                   request.assigned_at,
                   request.revision_number,
                   request.created_at,
                   request.updated_at,
                   ${includeTotalCount ? 'COUNT(*) OVER()::int AS total_count,' : ''}
                   COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                       'observationId', source.observation_id,
                       'revision', source.observation_revision
                     ) ORDER BY source.observation_id)
                     FROM student_follow_up_request_sources source
                     WHERE source.follow_up_request_id = request.id
                   ), '[]'::jsonb) AS sources
            FROM student_follow_up_requests request
            JOIN users requester ON requester.id = request.requested_by
            LEFT JOIN users reviewer ON reviewer.id = request.reviewed_by
            LEFT JOIN users assignee ON assignee.id = request.assigned_by`;
  }

  async findPendingFollowUpForUpdate(
    studentUuid: string,
    queryRunner: QueryRunner,
  ): Promise<FollowUpRequestRow | null> {
    const result = await this.executor(queryRunner).query<FollowUpRequestRow>(
      `${this.followUpSelectSql()}
       WHERE request.student_uuid = $1
         AND request.follow_up_request_type = 'HOME_VISIT_CONSIDERATION'
         AND request.status = 'PENDING_REVIEW'
       LIMIT 1
       FOR UPDATE OF request`,
      [studentUuid],
    );
    return result.rows[0] ?? null;
  }

  async createFollowUpRequest(
    input: {
      studentUuid: string;
      schoolId: number;
      urgency: FollowUpUrgency;
      reason: string;
      note: string | null;
      requestedBy: number;
      teacherMembershipId: number;
      teacherGrantId: string | null;
      assignmentId: number;
    },
    queryRunner: QueryRunner,
  ): Promise<string> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `INSERT INTO student_follow_up_requests (
         student_uuid, school_id, urgency, request_reason, supplemental_note,
         requested_by, requester_teacher_membership_id,
         source_teacher_access_grant_id, source_assignment_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.studentUuid,
        input.schoolId,
        input.urgency,
        input.reason,
        input.note,
        input.requestedBy,
        input.teacherMembershipId,
        input.teacherGrantId,
        input.assignmentId,
      ],
    );
    return result.rows[0].id;
  }

  async mergePendingFollowUp(
    requestId: string,
    urgency: FollowUpUrgency,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `UPDATE student_follow_up_requests
       SET urgency = CASE WHEN urgency = 'URGENT' OR $2 = 'URGENT' THEN 'URGENT' ELSE 'NORMAL' END,
           revision_number = revision_number + 1
       WHERE id = $1 AND status = 'PENDING_REVIEW'`,
      [requestId, urgency],
    );
  }

  async addFollowUpSources(
    requestId: string,
    sources: ObservationSourceRef[],
    actorUserId: number,
    teacherGrantId: string | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `INSERT INTO student_follow_up_request_sources (
         follow_up_request_id, observation_id, observation_revision,
         added_by, source_teacher_access_grant_id
       )
       SELECT $1, source.observation_id, source.observation_revision, $4, $5
       FROM unnest($2::bigint[], $3::integer[])
         AS source(observation_id, observation_revision)
       ON CONFLICT (follow_up_request_id, observation_id) DO NOTHING`,
      [
        requestId,
        sources.map((source) => source.observationId),
        sources.map((source) => source.revision),
        actorUserId,
        teacherGrantId,
      ],
    );
  }

  async findFollowUpById(
    studentUuid: string,
    requestId: string,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<FollowUpRequestRow | null> {
    const result = await this.executor(queryRunner).query<FollowUpRequestRow>(
      `${this.followUpSelectSql()}
       WHERE request.student_uuid = $1 AND request.id = $2
       LIMIT 1
       ${lock ? 'FOR UPDATE OF request' : ''}`,
      [studentUuid, requestId],
    );
    return result.rows[0] ?? null;
  }

  async listFollowUps(
    studentUuid: string,
    page: number,
    limit: number,
    queryRunner?: QueryRunner,
  ): Promise<FollowUpRequestRow[]> {
    const offset = (page - 1) * limit;
    const result = await this.executor(queryRunner).query<FollowUpRequestRow>(
      `${this.followUpSelectSql(true)}
       WHERE request.student_uuid = $1
       ORDER BY request.created_at DESC, request.id DESC
       LIMIT $2 OFFSET $3`,
      [studentUuid, limit, offset],
    );
    return result.rows;
  }

  async reviewFollowUp(
    requestId: string,
    expectedRevision: number,
    decision: FollowUpReviewDecision,
    reason: string,
    reviewerId: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `UPDATE student_follow_up_requests
       SET status = $3,
           review_decision = $3,
           review_reason = $4,
           reviewed_by = $5,
           reviewed_at = now(),
           revision_number = revision_number + 1
       WHERE id = $1
         AND revision_number = $2
         AND status = 'PENDING_REVIEW'
       RETURNING id`,
      [requestId, expectedRevision, decision, reason, reviewerId],
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }
}
