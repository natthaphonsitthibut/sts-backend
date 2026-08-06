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
  TeacherAttendanceHistoryRow,
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

/** How the จัดการลิงก์เช็คชื่อ table narrows by LINE verification. */
export type TeacherLineFilter = 'VERIFIED' | 'NOT_VERIFIED' | 'REACHABLE';

export interface TeacherLinkRosterRow extends Record<string, unknown> {
  teacher_membership_id: string;
  teacher_id: string;
  teacher_display_name: string;
  teacher_email: string | null;
  assignment_count: number;
  grant_id: string | null;
  grant_status: TeacherAccessGrantStatus | null;
  has_token_cipher: boolean | null;
  issued_at: string | Date | null;
  expires_at: string | Date | null;
  last_used_at: string | Date | null;
  line_verified: boolean | null;
  line_friend_state: string | null;
  total_count: number | string;
}

/** One teacher's link plus the chat account it can be delivered to. */
export interface TeacherGrantDeliveryRow extends Record<string, unknown> {
  teacher_membership_id: string;
  teacher_id: string;
  teacher_display_name: string;
  grant_id: string | null;
  grant_status: TeacherAccessGrantStatus | null;
  token_encrypted: string | null;
  provider_user_id: string | null;
  friend_state: string | null;
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
               membership.membership_status, teacher.teacher_status
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
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
          classroom.card_cover_color,
          (classroom.cover_image_storage_key IS NOT NULL) AS has_cover_image,
          classroom.cover_image_position_x,
          classroom.cover_image_position_y,
          classroom.cover_image_scale,
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

  /**
   * Active assignments for one or more teachers in a term. Bulk issuing asks for
   * every selected teacher at once, so this takes a list rather than firing one
   * query per teacher across a 400-teacher school.
   */
  async listAssignmentOptions(
    input: {
      schoolId: number;
      schoolTermId: number;
      teacherMembershipIds: number[];
      onDate: string;
    },
    queryRunner?: QueryRunner,
  ): Promise<TeacherAccessAssignmentRow[]> {
    if (input.teacherMembershipIds.length === 0) return [];
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
          classroom.card_cover_color,
          (classroom.cover_image_storage_key IS NOT NULL) AS has_cover_image,
          classroom.cover_image_position_x,
          classroom.cover_image_position_y,
          classroom.cover_image_scale,
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
          AND assignment.teacher_membership_id = ANY($3::bigint[])
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND (assignment.effective_on IS NULL OR assignment.effective_on <= $4::date)
          AND (assignment.effective_until IS NULL OR assignment.effective_until >= $4::date)
        ORDER BY assignment.teacher_membership_id, classroom.grade_level_id, classroom.room_code,
                 assignment.assignment_kind, subject.name_th, assignment.id
      `,
      [input.schoolId, input.schoolTermId, input.teacherMembershipIds, input.onDate],
    );
    return result.rows;
  }

  async createGrant(
    input: {
      teacherMembershipId: number;
      schoolId: number;
      schoolTermId: number;
      tokenHash: string;
      tokenEncrypted: string;
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
          teacher_membership_id, school_id, school_term_id, token_hash, token_encrypted,
          step_up_policy, issued_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id::text
      `,
      [
        input.teacherMembershipId,
        input.schoolId,
        input.schoolTermId,
        input.tokenHash,
        input.tokenEncrypted,
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
        COALESCE(teacher_account.username, TRIM(teacher.first_name || ' ' || teacher.last_name)) AS teacher_username,
        TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
        teacher.email AS teacher_email,
        teacher.teacher_status AS teacher_status,
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
        access_grant.token_encrypted,
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
      JOIN teachers teacher ON teacher.id = membership.teacher_id
      LEFT JOIN users teacher_account ON teacher_account.id = membership.teacher_user_id
        -- teacher_user_id is nullable — a teacher created without a login account
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

  /**
   * Keep an issued link aligned with the teacher's current assignments in the
   * same school and term. The grant identity remains fixed; only server-owned
   * assignment/capability rows are refreshed, so client input cannot widen it.
   */
  async syncGrantScopeFromAssignments(
    grantId: string,
    onDate: string,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        DELETE FROM teacher_access_grant_assignments scope
        USING teacher_access_grants access_grant
        WHERE scope.grant_id = access_grant.id
          AND access_grant.id = $1::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM classroom_teacher_assignments assignment
            JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
            WHERE assignment.id = scope.assignment_id
              AND assignment.teacher_membership_id = access_grant.teacher_membership_id
              AND assignment.school_id = access_grant.school_id
              AND classroom.school_term_id = access_grant.school_term_id
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
              AND classroom.classroom_status = 'ACTIVE'
              AND classroom.deleted_at IS NULL
              AND (assignment.effective_on IS NULL OR assignment.effective_on <= $2::date)
              AND (assignment.effective_until IS NULL OR assignment.effective_until >= $2::date)
          )
      `,
      [grantId, onDate],
    );
    await this.executor(queryRunner).query(
      `
        INSERT INTO teacher_access_grant_assignments (
          grant_id, assignment_id, teacher_membership_id,
          school_id, school_term_id, classroom_id
        )
        SELECT
          access_grant.id,
          assignment.id,
          assignment.teacher_membership_id,
          assignment.school_id,
          classroom.school_term_id,
          classroom.id
        FROM teacher_access_grants access_grant
        JOIN classroom_teacher_assignments assignment
          ON assignment.teacher_membership_id = access_grant.teacher_membership_id
         AND assignment.school_id = access_grant.school_id
        JOIN school_classrooms classroom
          ON classroom.id = assignment.classroom_id
         AND classroom.school_term_id = access_grant.school_term_id
        WHERE access_grant.id = $1::uuid
          AND assignment.assignment_status = 'ACTIVE'
          AND assignment.deleted_at IS NULL
          AND classroom.classroom_status = 'ACTIVE'
          AND classroom.deleted_at IS NULL
          AND (assignment.effective_on IS NULL OR assignment.effective_on <= $2::date)
          AND (assignment.effective_until IS NULL OR assignment.effective_until >= $2::date)
        ON CONFLICT (grant_id, assignment_id) DO NOTHING
      `,
      [grantId, onDate],
    );
    await this.executor(queryRunner).query(
      `DELETE FROM teacher_access_grant_capabilities WHERE grant_id = $1::uuid`,
      [grantId],
    );
    await this.executor(queryRunner).query(
      `
        INSERT INTO teacher_access_grant_capabilities (grant_id, capability)
        SELECT DISTINCT $1::uuid, capability
        FROM (
          SELECT CASE assignment.assignment_kind
                   WHEN 'HOMEROOM' THEN 'HOMEROOM_ATTENDANCE'
                   WHEN 'SUBJECT' THEN 'SUBJECT_ATTENDANCE'
                 END AS capability
          FROM teacher_access_grant_assignments scope
          JOIN classroom_teacher_assignments assignment ON assignment.id = scope.assignment_id
          WHERE scope.grant_id = $1::uuid
          UNION ALL
          SELECT 'TEACHER_OBSERVATION'
          FROM teacher_access_grant_assignments scope
          JOIN classroom_teacher_assignments assignment ON assignment.id = scope.assignment_id
          WHERE scope.grant_id = $1::uuid AND assignment.assignment_kind = 'SUBJECT'
        ) derived
        WHERE capability IS NOT NULL
      `,
      [grantId],
    );
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
          classroom.card_cover_color,
          (classroom.cover_image_storage_key IS NOT NULL) AS has_cover_image,
          classroom.cover_image_position_x,
          classroom.cover_image_position_y,
          classroom.cover_image_scale,
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

  /** SQL expression mapping a grant row to its lifecycle status. */
  private grantStatusSql(alias: string): string {
    return `
      CASE
        WHEN ${alias}.revoked_at IS NOT NULL THEN 'REVOKED'
        WHEN ${alias}.expires_at <= now() THEN 'EXPIRED'
        WHEN membership.membership_status <> 'ACTIVE' OR teacher.teacher_status <> 'ACTIVE'
          THEN 'SUSPENDED'
        ELSE 'ACTIVE'
      END
    `;
  }

  /**
   * The teacher-link screen is a roster of teachers, not of grants: a teacher
   * with no link yet still needs a row (with a "create" action), so this starts
   * from memberships and left-joins the newest grant of the selected term.
   */
  async listTeacherLinkRoster(input: {
    schoolId: number;
    schoolTermId: number;
    onDate: string;
    search?: string;
    lineStatus?: TeacherLineFilter;
    sortBy?: 'name' | 'linkStatus';
    sortOrder?: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<TeacherLinkRosterRow[]> {
    const search = input.search ? `%${input.search}%` : null;
    const sortOrder = input.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const statusExpression = `
      CASE
        WHEN latest_grant.id IS NULL THEN 'NOT_CREATED'
        ELSE (${this.grantStatusSql('latest_grant')})
      END
    `;
    const sortExpression =
      input.sortBy === 'linkStatus'
        ? statusExpression
        : `teacher.first_name ${sortOrder}, teacher.last_name ${sortOrder}`;
    const result = await queryDataSource<TeacherLinkRosterRow>(
      this.dataSource,
      `
        SELECT
          membership.id::text AS teacher_membership_id,
          teacher.id::text AS teacher_id,
          TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
          teacher.email AS teacher_email,
          (
            SELECT COUNT(*)::int
            FROM classroom_teacher_assignments assignment
            JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
            WHERE assignment.teacher_membership_id = membership.id
              AND classroom.school_term_id = $2
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
              AND classroom.classroom_status = 'ACTIVE'
              AND classroom.deleted_at IS NULL
              AND (assignment.effective_on IS NULL OR assignment.effective_on <= $3::date)
              AND (assignment.effective_until IS NULL OR assignment.effective_until >= $3::date)
          ) AS assignment_count,
          latest_grant.id::text AS grant_id,
          CASE
            WHEN latest_grant.id IS NULL THEN NULL
            ELSE (${this.grantStatusSql('latest_grant')})
          END AS grant_status,
          (latest_grant.token_encrypted IS NOT NULL) AS has_token_cipher,
          latest_grant.issued_at,
          latest_grant.expires_at,
          latest_grant.last_used_at,
          (line_account.id IS NOT NULL) AS line_verified,
          line_account.friend_state AS line_friend_state,
          COUNT(*) OVER()::int AS total_count
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        LEFT JOIN LATERAL (
          SELECT access_grant.*
          FROM teacher_access_grants access_grant
          WHERE access_grant.teacher_membership_id = membership.id
            AND access_grant.school_term_id = $2
          ORDER BY access_grant.issued_at DESC, access_grant.id DESC
          LIMIT 1
        ) latest_grant ON TRUE
        LEFT JOIN teacher_messaging_accounts line_account
          ON line_account.teacher_id = teacher.id
         AND line_account.provider = 'LINE'
         AND line_account.unlinked_at IS NULL
         AND line_account.deleted_at IS NULL
        WHERE membership.school_id = $1
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
          AND (
            $4::text IS NULL
            OR TRIM(teacher.first_name || ' ' || teacher.last_name) ILIKE $4
          )
          AND (
            $7::text IS NULL
            OR ($7 = 'VERIFIED' AND line_account.id IS NOT NULL)
            OR ($7 = 'NOT_VERIFIED' AND line_account.id IS NULL)
            OR ($7 = 'REACHABLE' AND line_account.friend_state = 'FRIEND')
          )
        ORDER BY ${sortExpression}${input.sortBy === 'linkStatus' ? ` ${sortOrder}` : ''},
                 membership.id ${sortOrder}
        LIMIT $5 OFFSET $6
      `,
      [
        input.schoolId,
        input.schoolTermId,
        input.onDate,
        search,
        input.limit,
        (input.page - 1) * input.limit,
        input.lineStatus ?? null,
      ],
    );
    return result.rows;
  }

  /**
   * Everything the send action needs in one pass: the teacher, their current
   * link, and the chat account it could go to. Reading the messaging table here
   * rather than teacher by teacher keeps a 400-teacher school to one query.
   */
  async listGrantsForDelivery(input: {
    schoolId: number;
    schoolTermId: number;
    teacherMembershipIds?: number[];
  }): Promise<TeacherGrantDeliveryRow[]> {
    const result = await queryDataSource<TeacherGrantDeliveryRow>(
      this.dataSource,
      `
        SELECT
          membership.id::text AS teacher_membership_id,
          teacher.id::text AS teacher_id,
          TRIM(teacher.first_name || ' ' || teacher.last_name) AS teacher_display_name,
          latest_grant.id::text AS grant_id,
          CASE
            WHEN latest_grant.id IS NULL THEN NULL
            ELSE (${this.grantStatusSql('latest_grant')})
          END AS grant_status,
          latest_grant.token_encrypted,
          line_account.provider_user_id,
          line_account.friend_state
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        LEFT JOIN LATERAL (
          SELECT access_grant.*
          FROM teacher_access_grants access_grant
          WHERE access_grant.teacher_membership_id = membership.id
            AND access_grant.school_term_id = $2
          ORDER BY access_grant.issued_at DESC, access_grant.id DESC
          LIMIT 1
        ) latest_grant ON TRUE
        LEFT JOIN teacher_messaging_accounts line_account
          ON line_account.teacher_id = teacher.id
         AND line_account.provider = 'LINE'
         AND line_account.unlinked_at IS NULL
         AND line_account.deleted_at IS NULL
        WHERE membership.school_id = $1
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
          AND ($3::bigint[] IS NULL OR membership.id = ANY($3::bigint[]))
        ORDER BY membership.id
      `,
      [input.schoolId, input.schoolTermId, input.teacherMembershipIds ?? null],
    );
    return result.rows;
  }

  /**
   * Memberships the bulk action should issue for: active teachers who actually
   * teach something this term and have no usable link yet. Locked for update so
   * two admins pressing the button together cannot double-issue.
   *
   * `teacherMembershipIds` narrows the batch to the rows an admin picked in the
   * table; the scope, term and "needs a link" conditions still apply on top.
   */
  async listMembershipsNeedingGrant(
    input: {
      schoolId: number;
      schoolTermId: number;
      onDate: string;
      teacherMembershipIds?: number[];
    },
    queryRunner: QueryRunner,
  ): Promise<Array<{ teacher_membership_id: string }>> {
    const result = await this.executor(queryRunner).query<{ teacher_membership_id: string }>(
      `
        SELECT membership.id::text AS teacher_membership_id
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE membership.school_id = $1
          AND ($4::bigint[] IS NULL OR membership.id = ANY($4::bigint[]))
          AND membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
          AND teacher.deleted_at IS NULL
          AND teacher.teacher_status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
            FROM classroom_teacher_assignments assignment
            JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
            WHERE assignment.teacher_membership_id = membership.id
              AND classroom.school_term_id = $2
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
              AND classroom.classroom_status = 'ACTIVE'
              AND classroom.deleted_at IS NULL
              AND (assignment.effective_on IS NULL OR assignment.effective_on <= $3::date)
              AND (assignment.effective_until IS NULL OR assignment.effective_until >= $3::date)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM teacher_access_grants access_grant
            WHERE access_grant.teacher_membership_id = membership.id
              AND access_grant.school_term_id = $2
              AND access_grant.revoked_at IS NULL
              AND access_grant.expires_at > now()
          )
        ORDER BY membership.id
        FOR UPDATE OF membership
      `,
      [input.schoolId, input.schoolTermId, input.onDate, input.teacherMembershipIds ?? null],
    );
    return result.rows;
  }

  /**
   * Why a picked teacher was left out of a bulk issue. Only used when the admin
   * chose the rows themselves — an unexplained "skipped 3" is useless there,
   * while the issue-everyone button legitimately just skips silently.
   */
  async describeMembershipsForGrant(
    input: {
      schoolId: number;
      schoolTermId: number;
      onDate: string;
      teacherMembershipIds: number[];
    },
    queryRunner: QueryRunner,
  ): Promise<
    Array<{
      teacher_membership_id: string;
      is_active: boolean;
      assignment_count: string;
      has_active_grant: boolean;
    }>
  > {
    const result = await this.executor(queryRunner).query<{
      teacher_membership_id: string;
      is_active: boolean;
      assignment_count: string;
      has_active_grant: boolean;
    }>(
      `
        SELECT
          membership.id::text AS teacher_membership_id,
          (
            membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
            AND teacher.deleted_at IS NULL
            AND teacher.teacher_status = 'ACTIVE'
          ) AS is_active,
          (
            SELECT count(*)
            FROM classroom_teacher_assignments assignment
            JOIN school_classrooms classroom ON classroom.id = assignment.classroom_id
            WHERE assignment.teacher_membership_id = membership.id
              AND classroom.school_term_id = $2
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
              AND classroom.classroom_status = 'ACTIVE'
              AND classroom.deleted_at IS NULL
              AND (assignment.effective_on IS NULL OR assignment.effective_on <= $3::date)
              AND (assignment.effective_until IS NULL OR assignment.effective_until >= $3::date)
          )::text AS assignment_count,
          EXISTS (
            SELECT 1
            FROM teacher_access_grants access_grant
            WHERE access_grant.teacher_membership_id = membership.id
              AND access_grant.school_term_id = $2
              AND access_grant.revoked_at IS NULL
              AND access_grant.expires_at > now()
          ) AS has_active_grant
        FROM school_teacher_memberships membership
        JOIN teachers teacher ON teacher.id = membership.teacher_id
        WHERE membership.school_id = $1
          AND membership.id = ANY($4::bigint[])
      `,
      [input.schoolId, input.schoolTermId, input.onDate, input.teacherMembershipIds],
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
    tokenEncrypted: string,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        UPDATE teacher_access_grants
        SET token_hash = $2,
            token_encrypted = $3,
            rotated_at = now(),
            rotation_count = rotation_count + 1,
            updated_at = now()
        WHERE id = $1
      `,
      [grantId, tokenHash, tokenEncrypted],
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
          classroom.card_cover_color,
          (classroom.cover_image_storage_key IS NOT NULL) AS has_cover_image,
          classroom.cover_image_position_x,
          classroom.cover_image_position_y,
          classroom.cover_image_scale,
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
          enrollment.student_number,
          enrollment."FirstName_Onec" AS first_name,
          enrollment."LastName_Onec" AS last_name,
          enrollment.student_status_code,
          status.label_th AS student_status_label,
          risk.risk_tier,
          latest_comment.comment_text AS teacher_comment,
          COUNT(*) OVER()::int AS total_count
        FROM student_term enrollment
        LEFT JOIN student_status status ON status.code = enrollment.student_status_code
        LEFT JOIN student_risk_profiles risk ON risk.student_uuid = enrollment.student_uuid
        LEFT JOIN LATERAL (
          SELECT comment.comment_text
          FROM classroom_student_comments comment
          WHERE comment.classroom_id = enrollment.classroom_id
            AND comment.person_uuid = enrollment.person_uuid
          ORDER BY comment.created_at DESC, comment.id DESC
          LIMIT 1
        ) latest_comment ON TRUE
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

  /**
   * Timetable periods a subject assignment has on a given weekday. Subject
   * attendance is recorded per period, so the write path needs the slot; the
   * classroom is matched through its ONEC room number, which is what
   * `timetable_slots` stores.
   */
  async listAssignmentSlotsForDate(
    input: {
      classroomId: number;
      subjectId: number;
      teacherMembershipId: number;
      isoDayOfWeek: number;
    },
    queryRunner: QueryRunner,
  ): Promise<Array<{ id: string; period: number }>> {
    const result = await this.executor(queryRunner).query<{ id: string; period: number }>(
      `
        SELECT slot.id::text, slot.period
        FROM school_classrooms classroom
        JOIN timetable_slots slot
          ON slot.school_term_id = classroom.school_term_id
         AND slot.school_id = classroom.school_id
         AND slot.grade_level_id = classroom.grade_level_id
         AND slot.room_no = classroom.legacy_room_number
        JOIN timetable_slot_teachers slot_teacher
          ON slot_teacher.timetable_slot_id = slot.id
         AND slot_teacher.teacher_membership_id = $3
        WHERE classroom.id = $1
          AND classroom.deleted_at IS NULL
          AND slot.subject_id = $2
          AND slot.day_of_week = $4
          AND slot.deleted_at IS NULL
        ORDER BY slot.period
      `,
      [input.classroomId, input.subjectId, input.teacherMembershipId, input.isoDayOfWeek],
    );
    return result.rows;
  }

  async listClassroomSlotsForDate(
    classroomId: number,
    isoDayOfWeek: number,
    queryRunner: QueryRunner,
  ): Promise<Array<{ id: string }>> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `
        SELECT slot.id::text
        FROM school_classrooms classroom
        JOIN timetable_slots slot
          ON slot.classroom_id = classroom.id
        WHERE classroom.id = $1
          AND classroom.deleted_at IS NULL
          AND slot.day_of_week = $2
          AND slot.deleted_at IS NULL
        ORDER BY slot.period
      `,
      [classroomId, isoDayOfWeek],
    );
    return result.rows;
  }

  /**
   * Returns recent school days that have scheduled subject periods for the
   * classroom but no submitted subject-attendance session yet.  Demo writes
   * must never overwrite a teacher's existing attendance record.
   */
  async listRecentClassroomSchoolDays(
    classroomId: number,
    asOfDate: string,
    limit: number,
    recorderMarker: string,
    queryRunner: QueryRunner,
  ): Promise<string[]> {
    const result = await this.executor(queryRunner).query<{ attendance_date: string }>(
      `
        WITH classroom AS (
          SELECT id, school_term_id
          FROM school_classrooms
          WHERE id = $1 AND deleted_at IS NULL
        ), classroom_slots AS (
          SELECT slot.id, slot.day_of_week
          FROM timetable_slots slot
          JOIN classroom ON classroom.id = slot.classroom_id
          WHERE slot.deleted_at IS NULL
        ), classroom_days AS (
          SELECT term.id AS school_term_id, day_value::date AS calendar_date
          FROM school_terms term
          JOIN classroom ON classroom.school_term_id = term.id
          CROSS JOIN LATERAL generate_series(
            term.starts_on,
            LEAST(term.ends_on, $2::date),
            interval '1 day'
          ) day_value
          WHERE term.starts_on IS NOT NULL AND term.ends_on IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM school_calendar_days blocked_day
              WHERE blocked_day.school_term_id = term.id
                AND blocked_day.calendar_date = day_value::date
                AND blocked_day.day_type <> 'SCHOOL_DAY'
                AND blocked_day.deleted_at IS NULL
            )
        )
        SELECT classroom_day.calendar_date::text AS attendance_date
        FROM classroom_days classroom_day
        WHERE classroom_day.calendar_date <= $2::date
          AND EXISTS (
            SELECT 1
            FROM classroom_slots slot
            WHERE slot.day_of_week = EXTRACT(ISODOW FROM classroom_day.calendar_date)::int
          )
          AND NOT EXISTS (
            SELECT 1
            FROM attendance_sessions session
            JOIN classroom_slots slot ON slot.id = session.timetable_slot_id
            JOIN attendance record ON record.session_id = session.id
            WHERE session.session_kind = 'SUBJECT'
              AND session.attendance_date = classroom_day.calendar_date
              AND slot.classroom_id = $1
              AND record."RecordedBy" IS DISTINCT FROM $4
          )
        ORDER BY classroom_day.calendar_date DESC
        LIMIT $3
      `,
      [classroomId, asOfDate, limit, recorderMarker],
    );
    return result.rows.map((row) => row.attendance_date).reverse();
  }

  async ensureDemoSchoolDays(
    classroomId: number,
    dates: string[],
    actorUserId: number | null,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.executor(queryRunner).query(
      `
        INSERT INTO school_calendar_days (
          school_term_id, calendar_date, day_type, reason, source, created_by, updated_by
        )
        SELECT classroom.school_term_id, day_value, 'SCHOOL_DAY',
               'ข้อมูลสาธิตการเช็คชื่อย้อนหลัง', 'MANUAL', $3, $3
        FROM school_classrooms classroom
        CROSS JOIN UNNEST($2::date[]) AS day_value
        WHERE classroom.id = $1 AND classroom.deleted_at IS NULL
        ON CONFLICT (school_term_id, calendar_date) DO NOTHING
      `,
      [classroomId, dates, actorUserId],
    );
  }

  async hasNonDemoAttendanceSessions(
    classroomId: number,
    dates: string[],
    recorderMarker: string,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM attendance_sessions session
          JOIN timetable_slots slot ON slot.id = session.timetable_slot_id
          WHERE slot.classroom_id = $1
            AND session.session_kind = 'SUBJECT'
            AND session.attendance_date = ANY($2::date[])
            AND EXISTS (
              SELECT 1
              FROM attendance record
              WHERE record.session_id = session.id
                AND record."RecordedBy" IS DISTINCT FROM $3
            )
        ) AS exists
      `,
      [classroomId, dates, recorderMarker],
    );
    return result.rows[0]?.exists === true;
  }

  /** Deletes only subject sessions wholly created by the temporary demo action. */
  async deleteClassroomRecentAttendance(
    classroomId: number,
    dates: string[],
    recorderMarker: string,
    queryRunner: QueryRunner,
  ): Promise<number> {
    const result = await this.executor(queryRunner).query<{ id: string }>(
      `
        WITH recent_sessions AS (
          SELECT session.id
          FROM attendance_sessions session
          JOIN timetable_slots slot ON slot.id = session.timetable_slot_id
          WHERE slot.classroom_id = $1
            AND session.session_kind = 'SUBJECT'
            AND session.attendance_date = ANY($2::date[])
            AND EXISTS (
              SELECT 1 FROM attendance demo_record
              WHERE demo_record.session_id = session.id
                AND demo_record."RecordedBy" = $3
            )
            AND NOT EXISTS (
              SELECT 1 FROM attendance real_record
              WHERE real_record.session_id = session.id
                AND real_record."RecordedBy" IS DISTINCT FROM $3
            )
        ), deleted_records AS (
          DELETE FROM attendance
          WHERE session_id IN (SELECT id FROM recent_sessions)
        )
        DELETE FROM attendance_sessions
        WHERE id IN (SELECT id FROM recent_sessions)
        RETURNING id::text
      `,
      [classroomId, dates, recorderMarker],
    );
    return result.rows.length;
  }

  /**
   * Attendance sessions already recorded for a class, newest first, with the
   * per-status tally the history screen shows. Subject assignments only count
   * their own periods; a homeroom link sees the DAILY sessions.
   */
  async listAttendanceHistory(
    input: {
      classroomId: number;
      sessionKind: 'DAILY' | 'SUBJECT';
      subjectId: number | null;
      search?: string;
      attendanceDate?: string;
      sortBy?: 'date' | 'recordedBy' | 'present' | 'late' | 'leave' | 'absent';
      sortOrder?: 'asc' | 'desc';
      page: number;
      limit: number;
    },
    queryRunner: QueryRunner,
  ): Promise<TeacherAttendanceHistoryRow[]> {
    const sortColumn =
      {
        date: 'attendance_date',
        recordedBy: 'recorded_by',
        present: 'present_count',
        late: 'late_count',
        leave: 'leave_count',
        absent: 'absent_count',
      }[input.sortBy ?? 'date'] ?? 'attendance_date';
    const sortOrder = input.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const result = await this.executor(queryRunner).query<TeacherAttendanceHistoryRow>(
      `
        WITH history_rows AS (
          SELECT
            session.id::text,
            session.attendance_date::text,
            session.period,
            session.status,
            session.submitted_at,
            (
            -- Same resolution as the staff history: RecordedBy stores a
            -- username, so the display name comes from the account behind it.
            SELECT STRING_AGG(
              DISTINCT COALESCE(
                NULLIF(BTRIM(CONCAT_WS(' ', recorder."FirstName", recorder."LastName")), ''),
                CASE
                  WHEN record."RecordedBy" LIKE '%@%' THEN NULL
                  ELSE NULLIF(record."RecordedBy", '')
                END,
                '-'
              ),
              ', '
            )
            FROM attendance record
            LEFT JOIN users recorder ON recorder.username = record."RecordedBy"
            WHERE record.session_id = session.id
            ) AS recorded_by,
            COUNT(*) FILTER (WHERE record."AttendanceStatus" = 1)::int AS present_count,
            COUNT(*) FILTER (WHERE record."AttendanceStatus" = 3)::int AS late_count,
            COUNT(*) FILTER (WHERE record."AttendanceStatus" = 4)::int AS leave_count,
            COUNT(*) FILTER (WHERE record."AttendanceStatus" = 2)::int AS absent_count
          FROM school_classrooms classroom
          JOIN attendance_sessions session
            ON session.school_term_id = classroom.school_term_id
           AND session.school_id = classroom.school_id
           AND session.grade_level_id = classroom.grade_level_id
           AND session.room_id = classroom.legacy_room_number
          LEFT JOIN attendance record ON record.session_id = session.id
          WHERE classroom.id = $1
            AND classroom.deleted_at IS NULL
            AND session.deleted_at IS NULL
            AND session.session_kind = $2
            AND ($3::int IS NULL OR session.subject_id = $3::int)
          GROUP BY session.id
        )
        SELECT history_rows.*, COUNT(*) OVER()::int AS total_count
        FROM history_rows
        WHERE ($4::text IS NULL OR COALESCE(recorded_by, '') ILIKE $4::text)
          AND ($5::date IS NULL OR attendance_date::date = $5::date)
        ORDER BY ${sortColumn} ${sortOrder}, attendance_date DESC, period DESC, id
        LIMIT $6 OFFSET $7
      `,
      [
        input.classroomId,
        input.sessionKind,
        input.subjectId,
        input.search ? `%${input.search}%` : null,
        input.attendanceDate ?? null,
        input.limit,
        (input.page - 1) * input.limit,
      ],
    );
    return result.rows;
  }

  /** Same หมายเหตุ store the school staff write to, from the teacher's own class. */
  async createStudentComment(
    input: {
      classroomId: number;
      studentUuid: string;
      commentText: string;
      authoredByUserId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<{ id: string; comment_text: string } | null> {
    const result = await this.executor(queryRunner).query<{ id: string; comment_text: string }>(
      `
        INSERT INTO classroom_student_comments (
          classroom_id, person_uuid, comment_text, authored_by_user_id
        )
        SELECT $1, enrollment.person_uuid, $3, $4
        FROM student_term enrollment
        WHERE enrollment.student_uuid = $2
          AND enrollment.classroom_id = $1
          AND enrollment.deleted_at IS NULL
          AND enrollment.person_uuid IS NOT NULL
        RETURNING id::text, comment_text
      `,
      [input.classroomId, input.studentUuid, input.commentText, input.authoredByUserId],
    );
    return result.rows[0] ?? null;
  }

  async findClassroomPresentation(
    classroomId: number,
    queryRunner?: QueryRunner,
  ): Promise<{
    card_cover_color: string;
    cover_image_storage_key: string | null;
    cover_image_position_x: number;
    cover_image_position_y: number;
    cover_image_scale: number;
    updated_at: string | Date;
  } | null> {
    const result = await this.executor(queryRunner).query<{
      card_cover_color: string;
      cover_image_storage_key: string | null;
      cover_image_position_x: number;
      cover_image_position_y: number;
      cover_image_scale: number;
      updated_at: string | Date;
    }>(
      `
        SELECT card_cover_color, cover_image_storage_key,
               cover_image_position_x, cover_image_position_y, cover_image_scale,
               updated_at
        FROM school_classrooms
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [classroomId],
    );
    return result.rows[0] ?? null;
  }

  /** Card presentation of a class, changed from the teacher's own view. */
  async updateClassroomPresentation(
    input: {
      classroomId: number;
      cardCoverColor: string;
      coverImageStorageKey: string | null;
      coverImagePositionX: number;
      coverImagePositionY: number;
      coverImageScale: number;
      actorUserId: number | null;
    },
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    const result = await this.executor(queryRunner).query(
      `
        UPDATE school_classrooms
        SET card_cover_color = $2,
            cover_image_storage_key = $3,
            cover_image_position_x = $4,
            cover_image_position_y = $5,
            cover_image_scale = $6,
            updated_by = $7,
            updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [
        input.classroomId,
        input.cardCoverColor,
        input.coverImageStorageKey,
        input.coverImagePositionX,
        input.coverImagePositionY,
        input.coverImageScale,
        input.actorUserId,
      ],
    );
    return (result.rowCount ?? 0) > 0;
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
