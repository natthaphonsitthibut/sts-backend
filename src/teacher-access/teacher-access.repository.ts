import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import type { TeacherAccessCapability } from './teacher-access.constants';
import type {
  TeacherAccessAssignmentRow,
  TeacherAccessGrantDetail,
  TeacherAccessGrantRow,
  TeacherAccessGrantStatus,
  TeacherAccessRosterRow,
} from './teacher-access.types';

interface TermIssueRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  academic_year: number;
  semester: number;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
}

interface MembershipIssueRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  teacher_user_id: number;
  membership_status: 'ACTIVE' | 'INACTIVE';
  teacher_status: string;
}

interface QueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

@Injectable()
export class TeacherAccessRepository {
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
    return queryRunner ? createSqlQueryExecutor(queryRunner) : this.dataSourceExecutor();
  }

  private dataSourceExecutor(): QueryExecutor {
    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        await queryDataSource<T>(this.dataSource, sql, params),
    };
  }

  async isSchoolInScope(schoolId: number, scope: DataScope): Promise<boolean> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'school.id',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
      },
      2,
    );
    const result = await queryDataSource(
      this.dataSource,
      `
        SELECT 1
        FROM schools school
        WHERE school.id = $1
          AND school.school_status = 'ACTIVE'
          AND ${scopeQuery.sql || 'TRUE'}
        LIMIT 1
      `,
      [schoolId, ...scopeQuery.params],
    );
    return result.rows.length > 0;
  }

  async findTermForIssue(termId: number, queryRunner: QueryRunner): Promise<TermIssueRow | null> {
    const result = await this.executor(queryRunner).query<TermIssueRow>(
      `
        SELECT id::text, school_id, academic_year, semester, status,
               starts_on::text, ends_on::text
        FROM school_terms
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE
      `,
      [termId],
    );
    return result.rows[0] ?? null;
  }

  async findMembershipForIssue(
    membershipId: number,
    queryRunner: QueryRunner,
  ): Promise<MembershipIssueRow | null> {
    const result = await this.executor(queryRunner).query<MembershipIssueRow>(
      `
        SELECT membership.id::text, membership.school_id, membership.teacher_user_id,
               membership.membership_status, teacher.status AS teacher_status
        FROM school_teacher_memberships membership
        JOIN users teacher ON teacher.id = membership.teacher_user_id
        WHERE membership.id = $1 AND membership.deleted_at IS NULL
        FOR UPDATE OF membership
      `,
      [membershipId],
    );
    return result.rows[0] ?? null;
  }

  async listAssignmentsForIssue(
    assignmentIds: number[],
    queryRunner: QueryRunner,
  ): Promise<TeacherAccessAssignmentRow[]> {
    if (assignmentIds.length === 0) return [];
    const result = await this.executor(queryRunner).query<TeacherAccessAssignmentRow>(
      `
        SELECT
          assignment.id::text AS assignment_id,
          assignment.teacher_membership_id::text,
          assignment.school_id,
          classroom.id::text AS classroom_id,
          classroom.school_term_id::text,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM classroom_teacher_assignments assignment
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.id = ANY($1::bigint[])
          AND assignment.deleted_at IS NULL
          AND classroom.deleted_at IS NULL
        ORDER BY assignment.id
        FOR UPDATE OF assignment
      `,
      [assignmentIds],
    );
    return result.rows;
  }

  async listAssignmentOptions(input: {
    schoolId: number;
    schoolTermId: number;
    teacherMembershipId: number;
    onDate: string;
  }): Promise<TeacherAccessAssignmentRow[]> {
    const result = await queryDataSource<TeacherAccessAssignmentRow>(
      this.dataSource,
      `
        SELECT
          assignment.id::text AS assignment_id,
          assignment.teacher_membership_id::text,
          assignment.school_id,
          classroom.id::text AS classroom_id,
          classroom.school_term_id::text,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM classroom_teacher_assignments assignment
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE assignment.school_id = $1
          AND classroom.school_term_id = $2
          AND assignment.teacher_membership_id = $3
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND (assignment.effective_on IS NULL OR assignment.effective_on <= $4::date)
          AND (assignment.effective_until IS NULL OR assignment.effective_until >= $4::date)
        ORDER BY classroom.grade_level_id, classroom.room_code,
                 assignment.assignment_kind, subject.name_th, assignment.id
      `,
      [input.schoolId, input.schoolTermId, input.teacherMembershipId, input.onDate],
    );
    return result.rows;
  }

  async createGrant(
    input: {
      teacherMembershipId: number;
      schoolId: number;
      schoolTermId: number;
      tokenHash: string;
      stepUpPolicy: string;
      issuedBy: number;
      expiresAt: Date;
      capabilities: TeacherAccessCapability[];
      assignmentIds: number[];
    },
    queryRunner: QueryRunner,
  ): Promise<string> {
    const executor = this.executor(queryRunner);
    const grant = await executor.query<{ id: string }>(
      `
        INSERT INTO teacher_access_grants (
          teacher_membership_id, school_id, school_term_id, token_hash,
          step_up_policy, issued_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id::text
      `,
      [
        input.teacherMembershipId,
        input.schoolId,
        input.schoolTermId,
        input.tokenHash,
        input.stepUpPolicy,
        input.issuedBy,
        input.expiresAt,
      ],
    );
    const grantId = grant.rows[0].id;
    await executor.query(
      `
        INSERT INTO teacher_access_grant_capabilities (grant_id, capability)
        SELECT $1::uuid, capability
        FROM unnest($2::varchar[]) capability
      `,
      [grantId, input.capabilities],
    );
    await executor.query(
      `
        INSERT INTO teacher_access_grant_assignments (
          grant_id, assignment_id, teacher_membership_id,
          school_id, school_term_id, classroom_id
        )
        SELECT
          $1::uuid,
          assignment.id,
          assignment.teacher_membership_id,
          assignment.school_id,
          classroom.school_term_id,
          assignment.classroom_id
        FROM unnest($2::bigint[]) requested(assignment_id)
        JOIN classroom_teacher_assignments assignment ON assignment.id = requested.assignment_id
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
      `,
      [grantId, input.assignmentIds],
    );
    return grantId;
  }

  private grantSelectSql(): string {
    return `
      SELECT
        access_grant.id::text,
        access_grant.teacher_membership_id::text,
        membership.teacher_user_id,
        teacher.username AS teacher_username,
        COALESCE(
          NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), ''),
          teacher.username
        ) AS teacher_display_name,
        teacher.status AS teacher_status,
        membership.membership_status,
        membership.deleted_at AS membership_deleted_at,
        access_grant.school_id,
        school.name AS school_name,
        school.school_status,
        access_grant.school_term_id::text,
        term.academic_year,
        term.semester,
        term.status AS term_status,
        term.deleted_at AS term_deleted_at,
        term.starts_on::text AS term_starts_on,
        term.ends_on::text AS term_ends_on,
        access_grant.token_hash,
        access_grant.step_up_policy,
        access_grant.issued_by,
        issuer.username AS issuer_name,
        access_grant.issued_at,
        access_grant.expires_at,
        access_grant.last_used_at,
        access_grant.revoked_at,
        access_grant.revoked_by,
        access_grant.revocation_reason,
        access_grant.rotated_at,
        access_grant.rotation_count,
        ARRAY(
          SELECT capability
          FROM teacher_access_grant_capabilities capability_scope
          WHERE capability_scope.grant_id = access_grant.id
          ORDER BY capability
        ) AS capabilities,
        (
          SELECT COUNT(*)::int
          FROM teacher_access_grant_assignments assignment_scope
          WHERE assignment_scope.grant_id = access_grant.id
        ) AS assignment_count
      FROM teacher_access_grants access_grant
      JOIN school_teacher_memberships membership
        ON membership.id = access_grant.teacher_membership_id
      JOIN users teacher ON teacher.id = membership.teacher_user_id
      JOIN schools school ON school.id = access_grant.school_id
      JOIN school_terms term ON term.id = access_grant.school_term_id
      JOIN users issuer ON issuer.id = access_grant.issued_by
    `;
  }

  async findGrantById(
    grantId: string,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<TeacherAccessGrantRow | null> {
    const result = await this.executor(queryRunner).query<TeacherAccessGrantRow>(
      `${this.grantSelectSql()} WHERE access_grant.id = $1 ${lock ? 'FOR UPDATE OF access_grant' : ''}`,
      [grantId],
    );
    return result.rows[0] ?? null;
  }

  async findGrantByTokenHashForUpdate(
    tokenHash: string,
    queryRunner: QueryRunner,
  ): Promise<TeacherAccessGrantRow | null> {
    const result = await this.executor(queryRunner).query<TeacherAccessGrantRow>(
      `${this.grantSelectSql()} WHERE access_grant.token_hash = $1 FOR UPDATE OF access_grant`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async listCapabilities(
    grantId: string,
    queryRunner?: QueryRunner,
  ): Promise<TeacherAccessCapability[]> {
    const result = await this.executor(queryRunner).query<{ capability: TeacherAccessCapability }>(
      `
        SELECT capability
        FROM teacher_access_grant_capabilities
        WHERE grant_id = $1
        ORDER BY capability
      `,
      [grantId],
    );
    return result.rows.map((row) => row.capability);
  }

  async listGrantAssignments(
    grantId: string,
    queryRunner?: QueryRunner,
  ): Promise<TeacherAccessAssignmentRow[]> {
    const result = await this.executor(queryRunner).query<TeacherAccessAssignmentRow>(
      `
        SELECT
          assignment.id::text AS assignment_id,
          assignment.teacher_membership_id::text,
          assignment.school_id,
          classroom.id::text AS classroom_id,
          classroom.school_term_id::text,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM teacher_access_grant_assignments scope
        JOIN classroom_teacher_assignments assignment ON assignment.id = scope.assignment_id
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE scope.grant_id = $1
          AND assignment.deleted_at IS NULL
          AND classroom.deleted_at IS NULL
        ORDER BY classroom.grade_level_id, classroom.room_code,
                 assignment.assignment_kind, subject.name_th, assignment.id
      `,
      [grantId],
    );
    return result.rows;
  }

  async getGrantDetail(
    grantId: string,
    queryRunner?: QueryRunner,
    lock = false,
  ): Promise<TeacherAccessGrantDetail | null> {
    const grant = await this.findGrantById(grantId, queryRunner, lock);
    if (!grant) return null;
    const capabilities = await this.listCapabilities(grantId, queryRunner);
    const assignments = await this.listGrantAssignments(grantId, queryRunner);
    return { grant, capabilities, assignments };
  }

  async listGrants(input: {
    schoolId: number;
    schoolTermId?: number;
    status?: 'ALL' | TeacherAccessGrantStatus;
    page: number;
    limit: number;
  }): Promise<TeacherAccessGrantRow[]> {
    const params: unknown[] = [input.schoolId];
    const termClause = input.schoolTermId
      ? `AND access_grant.school_term_id = $${params.push(input.schoolTermId)}`
      : '';
    const statusExpression = `
      CASE
        WHEN access_grant.revoked_at IS NOT NULL THEN 'REVOKED'
        WHEN access_grant.expires_at <= now() THEN 'EXPIRED'
        WHEN membership.membership_status <> 'ACTIVE' OR term.status <> 'ACTIVE' THEN 'SUSPENDED'
        ELSE 'ACTIVE'
      END
    `;
    const statusClause =
      input.status && input.status !== 'ALL'
        ? `AND (${statusExpression}) = $${params.push(input.status)}`
        : '';
    params.push(input.limit, (input.page - 1) * input.limit);
    const result = await queryDataSource<TeacherAccessGrantRow>(
      this.dataSource,
      `
        SELECT grant_rows.*, COUNT(*) OVER()::int AS total_count
        FROM (
          ${this.grantSelectSql()}
          WHERE access_grant.school_id = $1
            ${termClause}
            ${statusClause}
        ) grant_rows
        ORDER BY grant_rows.issued_at DESC, grant_rows.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return result.rows;
  }

  async revokeGrant(
    grantId: string,
    actorId: number,
    reason: string,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        UPDATE teacher_access_grants
        SET revoked_at = now(), revoked_by = $2, revocation_reason = $3, updated_at = now()
        WHERE id = $1 AND revoked_at IS NULL
      `,
      [grantId, actorId, reason],
    );
  }

  async rotateGrantToken(
    grantId: string,
    tokenHash: string,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        UPDATE teacher_access_grants
        SET token_hash = $2,
            rotated_at = now(),
            rotation_count = rotation_count + 1,
            updated_at = now()
        WHERE id = $1
      `,
      [grantId, tokenHash],
    );
  }

  async touchGrant(grantId: string, queryRunner: QueryRunner): Promise<void> {
    await this.executor(queryRunner).query(
      `UPDATE teacher_access_grants SET last_used_at = now(), updated_at = now() WHERE id = $1`,
      [grantId],
    );
  }

  async findGrantAssignment(
    grantId: string,
    assignmentId: number,
    queryRunner: QueryRunner,
  ): Promise<TeacherAccessAssignmentRow | null> {
    const assignments = await this.executor(queryRunner).query<TeacherAccessAssignmentRow>(
      `
        SELECT
          assignment.id::text AS assignment_id,
          assignment.teacher_membership_id::text,
          assignment.school_id,
          classroom.id::text AS classroom_id,
          classroom.school_term_id::text,
          classroom.grade_level_id,
          grade.label AS grade_label,
          classroom.legacy_room_number,
          classroom.room_code,
          classroom.room_name,
          classroom.classroom_status,
          assignment.assignment_kind,
          assignment.assignment_status,
          assignment.subject_id,
          subject.code AS subject_code,
          subject.name_th AS subject_name,
          assignment.effective_on::text,
          assignment.effective_until::text
        FROM teacher_access_grant_assignments scope
        JOIN classroom_teacher_assignments assignment ON assignment.id = scope.assignment_id
        JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
        JOIN grade_levels grade ON grade.id = classroom.grade_level_id
        LEFT JOIN subjects subject ON subject.id = assignment.subject_id
        WHERE scope.grant_id = $1
          AND scope.assignment_id = $2
          AND assignment.deleted_at IS NULL
          AND classroom.deleted_at IS NULL
        FOR UPDATE OF assignment
      `,
      [grantId, assignmentId],
    );
    return assignments.rows[0] ?? null;
  }

  async listRoster(
    classroomId: number,
    searchTerm: string | undefined,
    page: number,
    limit: number,
    queryRunner: QueryRunner,
  ): Promise<TeacherAccessRosterRow[]> {
    const search = searchTerm ? `%${searchTerm}%` : null;
    const result = await this.executor(queryRunner).query<TeacherAccessRosterRow>(
      `
        SELECT
          enrollment.student_uuid::text,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          enrollment.student_status_code,
          status.label_th AS student_status_label,
          COUNT(*) OVER()::int AS total_count
        FROM student_term enrollment
        LEFT JOIN student_status status ON status.code = enrollment.student_status_code
        WHERE enrollment.classroom_id = $1
          AND enrollment.deleted_at IS NULL
          AND (
            $2::text IS NULL
            OR COALESCE(enrollment."FirstName_Onec", '') ILIKE $2
            OR COALESCE(enrollment."LastName_Onec", '') ILIKE $2
          )
        ORDER BY enrollment."FirstName_Onec", enrollment."LastName_Onec", enrollment.student_uuid
        LIMIT $3 OFFSET $4
      `,
      [classroomId, search, limit, (page - 1) * limit],
    );
    return result.rows;
  }

  async listRosterIds(classroomId: number, queryRunner: QueryRunner): Promise<string[]> {
    const result = await this.executor(queryRunner).query<{ student_uuid: string }>(
      `
        SELECT student_uuid::text
        FROM student_term
        WHERE classroom_id = $1 AND deleted_at IS NULL
        ORDER BY student_uuid
      `,
      [classroomId],
    );
    return result.rows.map((row) => row.student_uuid);
  }

  async isStudentInClassroom(
    studentUuid: string,
    classroomId: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        SELECT 1
        FROM student_term
        WHERE student_uuid = $1 AND classroom_id = $2 AND deleted_at IS NULL
        LIMIT 1
      `,
      [studentUuid, classroomId],
    );
    return result.rows.length > 0;
  }

  async getAlertTriggerType(): Promise<string | null> {
    return await this.getSystemSettingValue('ALERT_TRIGGER_TYPE');
  }

  async getSystemSettingValue(key: string, queryRunner?: QueryRunner): Promise<string | null> {
    const result = await this.executor(queryRunner).query<{ setting_value: string }>(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1 LIMIT 1`,
      [key],
    );
    return result.rows[0]?.setting_value ?? null;
  }
}
