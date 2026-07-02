import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  QueryResultLike,
  QueryResultRow,
  RoleDefinition,
} from './task.types';

export interface CaseListFilters {
  status?: string;
  searchTerm?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  grade?: string;
  room?: string;
  page?: number;
  limit?: number;
}

export interface LoginLinkListFilters {
  actorRole: string | null;
  actorRank: number;
  actorScope?: DataScope;
  status?: string;
  searchTerm?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  gradeLevelId?: number;
  room?: string;
  page?: number;
  limit?: number;
}

export interface LoginLinkSummary {
  total: number;
  active: number;
  locked: number;
  expired: number;
}

interface CreateCaseInput {
  studentName: string;
  studentFirstName: string | null;
  studentLastName: string | null;
  studentSchool: string | null;
  studentAddress: string | null;
  addressLine: string | null;
  addressProvince: string | null;
  addressDistrict: string | null;
  addressSubDistrict: string | null;
  postalCode: string | null;
  studentLat: number | null;
  studentLng: number | null;
  reasonFlagged: string | null;
  studentUuid: string | null;
  schoolId: number | null;
  createdBy: number | null;
}

interface CreateTaskInput {
  taskId: string;
  caseId: number | null;
  taskType: string;
  targetGrade: string | null;
  targetRoom: string | null;
  targetSchoolId: number | null;
  createdBy: number | null;
}

interface CreateTaskLinkInput {
  linkId: string;
  taskId: string;
  parentLinkId: string | null;
  tokenHash: string;
  magicLink: string;
  delegationDepth: number;
  assignedToName: string;
  assignedToPhone: string | null;
  assignedToEmail: string | null;
  expiresAt: string;
  subject: string | null;
  otpVerified: number;
  createdBy: number | null;
  loginRole: string | null;
  loginPermissions: string[];
  loginDataScope: DataScope | Record<string, unknown>;
}

interface TaskStudentFilters {
  targetGrade?: string | null;
  targetRoom?: string | null;
  targetSchoolId?: number | null;
}

interface TaskSubmissionInput {
  linkId: string;
  visitLat: number | null;
  visitLng: number | null;
  causeCategory: string | null;
  causeDetail: string | null;
  recommendation: string | null;
  photoPaths: string | null;
  addressChanged: boolean;
  updatedStudentAddress: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
}

interface AttendanceReplaceInput {
  studentUuid: string;
  attendanceDate: string;
  attendanceStatus: number;
  recordedBy: string;
  schoolId: number;
  gradeLevelId: number;
  roomId: number;
  semester: number;
  academicYear: number;
}

interface CaseSubmissionUpdateInput {
  caseId: number;
  nextSummary: string;
  updatedStudentAddress: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
}

interface TaskLinkOtpInput {
  linkId: string;
  otpCode: string;
  otpExpiresAt: string;
}

interface AdminLockUpdateInput {
  linkId: string;
  locked: boolean;
  reason?: string;
  lockedAt?: string | null;
}

interface CaseReviewInput {
  reviewId: string;
  caseId: number;
  reviewAction: string;
  reviewNote: string | null;
  resolutionOutcome: string | null;
  reviewedBy: string;
}

interface CaseReferralInput {
  referralId: string;
  caseId: number;
  agencyId: number;
  agencyName: string;
  agencyType: string;
  referredBy: number | null;
  referredByLabel: string | null;
  referralNote: string | null;
  createdBy: number | null;
}

interface CaseReferralOutcomeInput {
  referralId: string;
  status: string;
  outcome: string | null;
  updatedBy: number | null;
}

interface CountRow extends QueryResultRow {
  count: number | string;
}

interface CaseStatusCountRow extends QueryResultRow {
  status: string;
  count: number | string;
}

interface ScopeQuery {
  sql: string;
  params: unknown[];
}

interface SettingValueRow extends QueryResultRow {
  setting_value?: unknown;
}

@Injectable()
export class TaskRepository {
  constructor(private readonly dataSource: DataSource) {}

  private normalizeScalar(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    return '';
  }

  private async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private normalizeScopeArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
    );
  }

  private normalizeScopeIntArray(value: unknown): number[] {
    return this.normalizeScopeArray(value)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item));
  }

  private buildCaseScopeQuery(
    actor: ActorContext | undefined,
    startIndex = 1,
    caseAlias = 'c',
  ): ScopeQuery {
    // An unconfigured actor scope (no areas, no explicit global/own_only) must
    // never widen the case list to every row — fail closed instead. own_only is
    // handled below (restricts to the actor's own created rows).
    if (isUnconfiguredDataScope(actor?.data_scope)) {
      return { sql: '1=0', params: [] };
    }
    const scope = actor?.data_scope || {};
    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = startIndex;

    const schoolIds = this.normalizeScopeIntArray(scope.school_ids);
    if (schoolIds.length > 0) {
      conditions.push(`${caseAlias}.school_id = ANY($${paramIndex++}::int[])`);
      params.push(schoolIds);
    }

    const schoolConditions: string[] = [];
    const provinces = this.normalizeScopeArray(scope.provinces);
    if (provinces.length > 0) {
      schoolConditions.push(`case_scope_school.province = ANY($${paramIndex++}::text[])`);
      params.push(provinces);
    }

    const districts = this.normalizeScopeArray(scope.districts);
    if (districts.length > 0) {
      schoolConditions.push(`case_scope_school.district = ANY($${paramIndex++}::text[])`);
      params.push(districts);
    }

    const subDistricts = this.normalizeScopeArray(scope.sub_districts);
    if (subDistricts.length > 0) {
      schoolConditions.push(`case_scope_school.sub_district = ANY($${paramIndex++}::text[])`);
      params.push(subDistricts);
    }

    if (schoolConditions.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM schools case_scope_school
          WHERE case_scope_school.id = ${caseAlias}.school_id
            AND ${schoolConditions.join(' AND ')}
        )
      `);
    }

    const studentConditions: string[] = [];
    const gradeLevels = this.normalizeScopeIntArray(scope.grade_levels);
    if (gradeLevels.length > 0) {
      studentConditions.push(
        `case_scope_student."GradeLevelID_Onec" = ANY($${paramIndex++}::int[])`,
      );
      params.push(gradeLevels);
    }

    const roomIds = this.normalizeScopeIntArray(scope.room_ids);
    if (roomIds.length > 0) {
      studentConditions.push(`case_scope_student."RoomID_Onec" = ANY($${paramIndex++}::int[])`);
      params.push(roomIds);
    }

    if (studentConditions.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_scope_student
          WHERE case_scope_student.student_uuid = ${caseAlias}.student_uuid
            AND ${studentConditions.join(' AND ')}
        )
      `);
    }

    if (scope.own_only === true && Number.isInteger(actor?.id)) {
      conditions.push(`${caseAlias}.created_by = $${paramIndex++}`);
      params.push(actor?.id);
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : '',
      params,
    };
  }

  private buildJsonScopeSubsetQuery(
    scopeSql: string,
    actorScope: DataScope | undefined,
    startIndex = 1,
  ): ScopeQuery {
    // An unconfigured actor scope (no areas, no explicit global/own_only) must
    // never widen the list to every row — fail closed instead.
    if (isUnconfiguredDataScope(actorScope)) {
      return { sql: '1=0', params: [] };
    }
    const scope = actorScope || {};
    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = startIndex;

    const addScopeCondition = (key: keyof Omit<DataScope, 'own_only'>): void => {
      const actorValues = this.normalizeScopeArray(scope[key]);
      if (actorValues.length === 0) {
        return;
      }

      conditions.push(`
        CASE
          WHEN jsonb_typeof(${scopeSql} -> '${key}') = 'array' THEN
            jsonb_array_length(${scopeSql} -> '${key}') > 0
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(${scopeSql} -> '${key}') AS target_scope(value)
              WHERE NOT (target_scope.value = ANY($${paramIndex}::text[]))
            )
          ELSE FALSE
        END
      `);
      params.push(actorValues);
      paramIndex += 1;
    };

    addScopeCondition('provinces');
    addScopeCondition('districts');
    addScopeCondition('sub_districts');
    addScopeCondition('school_ids');
    addScopeCondition('grade_levels');
    addScopeCondition('room_ids');

    if (scope.own_only === true) {
      conditions.push(`COALESCE((${scopeSql} ->> 'own_only')::boolean, FALSE) = TRUE`);
    }

    return {
      sql: conditions.length > 0 ? conditions.join(' AND ') : '',
      params,
    };
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => {
      return await callback(executor);
    });
  }

  async getRoleDefinitions(): Promise<RoleDefinition[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT
        id,
        name,
        label,
        rank,
        default_permissions,
        scope_mode,
        scope_policy,
        is_assignable,
        is_system
      FROM roles
      WHERE is_assignable = TRUE
      ORDER BY rank DESC, name ASC
    `);

    return result.rows.map((row: QueryResultRow) => ({
      id: Number(row.id),
      name: this.normalizeScalar(row.name),
      label: this.normalizeScalar(row.label),
      rank: Number(row.rank) || 0,
      default_permissions: Array.isArray(row.default_permissions)
        ? row.default_permissions.filter(
            (permission: unknown): permission is string =>
              typeof permission === 'string' && permission.trim().length > 0,
          )
        : [],
      scope_mode: typeof row.scope_mode === 'string' ? row.scope_mode : 'flexible',
      scope_policy: row.scope_policy === 'OWN_ONLY' ? 'OWN_ONLY' : 'ASSIGNABLE',
      is_assignable: row.is_assignable !== false,
      is_system: row.is_system === true,
    }));
  }

  async findCaseById(
    caseId: number,
    executor?: QueryExecutor,
    actor?: ActorContext,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.getExecutor(executor).query(
      `
      SELECT id, school_id
      FROM cases c
      WHERE c.id = $1 AND c.deleted_at IS NULL${scopeSql}
      LIMIT 1
    `,
      [caseId, ...scopeQuery.params],
    );
    return result.rows[0] || null;
  }

  async createCase(data: CreateCaseInput, executor?: QueryExecutor): Promise<number> {
    const result = await this.getExecutor(executor).query(
      `
      INSERT INTO cases (
        student_name,
        student_first_name,
        student_last_name,
        student_school,
        student_address,
        address_line,
        address_province,
        address_district,
        address_sub_district,
        postal_code,
        student_lat,
        student_lng,
        reason_flagged,
        student_uuid,
        school_id,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
      RETURNING id
    `,
      [
        data.studentName,
        data.studentFirstName,
        data.studentLastName,
        data.studentSchool,
        data.studentAddress,
        data.addressLine,
        data.addressProvince,
        data.addressDistrict,
        data.addressSubDistrict,
        data.postalCode,
        data.studentLat,
        data.studentLng,
        data.reasonFlagged,
        data.studentUuid,
        data.schoolId,
        data.createdBy,
      ],
    );

    return Number(result.rows[0]?.id);
  }

  async updateCaseStatus(
    caseId: number,
    status: string,
    executor?: QueryExecutor,
    actor?: ActorContext,
  ): Promise<void> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 3);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    await this.getExecutor(executor).query(
      `UPDATE cases c SET status = $1 WHERE c.id = $2 AND c.deleted_at IS NULL${scopeSql}`,
      [status, caseId, ...scopeQuery.params],
    );
  }

  async createTask(data: CreateTaskInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO tasks (
        id,
        case_id,
        task_type,
        target_grade,
        target_room,
        status,
        target_school_id,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6, $7, $7)
    `,
      [
        data.taskId,
        data.caseId,
        data.taskType,
        data.targetGrade,
        data.targetRoom,
        data.targetSchoolId,
        data.createdBy,
      ],
    );
  }

  async createTaskLink(data: CreateTaskLinkInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_links (
        id,
        task_id,
        parent_link_id,
        token_hash,
        magic_link,
        delegation_depth,
        assigned_to_name,
        assigned_to_phone,
        assigned_to_email,
        expires_at,
        subject,
        otp_verified,
        created_by,
        updated_by,
        login_role,
        login_permissions,
        login_data_scope
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $13,
        $14,
        $15,
        $16
      )
    `,
      [
        data.linkId,
        data.taskId,
        data.parentLinkId,
        data.tokenHash,
        data.magicLink,
        data.delegationDepth,
        data.assignedToName,
        data.assignedToPhone,
        data.assignedToEmail,
        data.expiresAt,
        data.subject,
        data.otpVerified,
        data.createdBy,
        data.loginRole,
        JSON.stringify(data.loginPermissions),
        JSON.stringify(data.loginDataScope),
      ],
    );
  }

  async markLoginLinkUsed(linkId: string): Promise<void> {
    await this.query(
      `
        UPDATE task_links
        SET first_used_at = COALESCE(first_used_at, NOW())
        WHERE id = $1
          AND first_used_at IS NULL
      `,
      [linkId],
    );
  }

  async findTaskLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        t.status AS task_status,
        t.max_delegation_depth,
        s.name AS school_name
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async findCaseByTaskId(taskId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT c.*
      FROM cases c
      JOIN tasks t ON t.case_id = c.id
      WHERE t.id = $1 AND c.deleted_at IS NULL AND t.deleted_at IS NULL
    `,
      [taskId],
    );

    return result.rows[0] || null;
  }

  async listLoginLinksPaginated(
    filters: LoginLinkListFilters,
  ): Promise<{ rows: QueryResultRow[]; totalCount: number; summary: LoginLinkSummary }> {
    const params: unknown[] = [];
    const policyConditions: string[] = [
      `t.task_type = 'LOGIN'`,
      `tl.deleted_at IS NULL`,
      `t.deleted_at IS NULL`,
    ];
    const linkStateSql = `
      CASE
        WHEN tl.expires_at <= NOW() THEN 'EXPIRED'
        WHEN tl.admin_locked = 1 THEN 'LOCKED'
        ELSE 'ACTIVE'
      END
    `;
    const roleRankSql = 'COALESCE(r.rank, 0)';
    const scopeSql = `COALESCE(tl.login_data_scope::jsonb, '{}'::jsonb)`;

    params.push(filters.actorRank);
    const actorRankPlaceholder = params.length;
    params.push(filters.actorRole);
    const actorRolePlaceholder = params.length;
    policyConditions.push(`
      (
        ${roleRankSql} < $${actorRankPlaceholder}
        OR ($${actorRolePlaceholder} = 'ADMIN' AND ${roleRankSql} = $${actorRankPlaceholder})
      )
    `);

    const scopeQuery = this.buildJsonScopeSubsetQuery(
      scopeSql,
      filters.actorScope,
      params.length + 1,
    );
    if (scopeQuery.sql) {
      policyConditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    const policyParamCount = params.length;
    const filteredConditions = [...policyConditions];
    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      filteredConditions.push(`${linkStateSql} = $${params.length}`);
    }

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      const searchPlaceholder = params.length;
      filteredConditions.push(`
        (
          tl.assigned_to_name ILIKE $${searchPlaceholder}
          OR tl.assigned_to_email ILIKE $${searchPlaceholder}
          OR tl.login_role ILIKE $${searchPlaceholder}
          OR r.label ILIKE $${searchPlaceholder}
          OR tl.magic_link ILIKE $${searchPlaceholder}
          OR CASE (${linkStateSql})
            WHEN 'LOCKED' THEN 'ปิดใช้งาน'
            WHEN 'EXPIRED' THEN 'หมดอายุ'
            ELSE 'ใช้งาน'
          END ILIKE $${searchPlaceholder}
        )
      `);
    }

    const addLoginScopeFilter = (
      jsonKey: keyof Omit<DataScope, 'own_only'>,
      value: string,
    ): void => {
      params.push(value);
      filteredConditions.push(`
        jsonb_typeof(${scopeSql} -> '${jsonKey}') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeSql} -> '${jsonKey}') AS filter_scope(value)
          WHERE filter_scope.value = $${params.length}
        )
      `);
    };

    if (filters.province) {
      addLoginScopeFilter('provinces', filters.province);
    }
    if (filters.district) {
      addLoginScopeFilter('districts', filters.district);
    }
    if (filters.subDistrict) {
      addLoginScopeFilter('sub_districts', filters.subDistrict);
    }
    if (filters.schoolId) {
      addLoginScopeFilter('school_ids', String(filters.schoolId));
    }
    if (filters.gradeLevelId) {
      addLoginScopeFilter('grade_levels', String(filters.gradeLevelId));
    }
    if (filters.room) {
      addLoginScopeFilter('room_ids', filters.room);
    }

    const fromSql = `
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN roles r ON r.name = COALESCE(NULLIF(TRIM(tl.login_role), ''), 'TEACHER')
    `;
    const policyWhereSql = `WHERE ${policyConditions.join(' AND ')}`;
    const filteredWhereSql = `WHERE ${filteredConditions.join(' AND ')}`;

    const summaryResult = await this.query<QueryResultRow>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE link_state = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE link_state = 'LOCKED')::int AS locked,
        COUNT(*) FILTER (WHERE link_state = 'EXPIRED')::int AS expired
      FROM (
        SELECT ${linkStateSql} AS link_state
        ${fromSql}
        ${policyWhereSql}
      ) scoped_login_links
    `,
      params.slice(0, policyParamCount),
    );

    const countResult = await this.query<CountRow>(
      `SELECT COUNT(*)::int AS count ${fromSql} ${filteredWhereSql}`,
      params,
    );
    const totalCount = Number.parseInt(String(countResult.rows[0]?.count || '0'), 10);

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;
    const selectParams = [...params, limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;

    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id,
        tl.task_id,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.expires_at,
        tl.status,
        tl.magic_link,
        tl.admin_locked,
        tl.login_role,
        tl.login_permissions,
        tl.login_data_scope,
        tl.first_used_at,
        tl.created_by,
        r.label AS login_role_label,
        t.created_at,
        ${linkStateSql} AS link_state
      ${fromSql}
      ${filteredWhereSql}
      ORDER BY t.created_at DESC, tl.id DESC
      LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
    `,
      selectParams,
    );

    const summaryRow = summaryResult.rows[0] || {};
    return {
      rows: result.rows,
      totalCount,
      summary: {
        total: Number(summaryRow.total || 0),
        active: Number(summaryRow.active || 0),
        locked: Number(summaryRow.locked || 0),
        expired: Number(summaryRow.expired || 0),
      },
    };
  }

  /**
   * Soft-delete the whole task tree: tombstone the task and its delegation
   * links in one transaction so the accountability chain survives for audit
   * and recovery (was a hard `DELETE FROM tasks` that cascade-purged links).
   * task_submissions are FK-protected and hidden via their join to a live link.
   * Idempotent via `deleted_at IS NULL`; returns rows affected on the task.
   */
  async deleteTask(taskId: string, actorId?: number | null): Promise<QueryResultLike> {
    return await this.withTransaction(async (executor) => {
      await executor.query(
        `UPDATE task_links SET deleted_at = now(), deleted_by = $2 WHERE task_id = $1 AND deleted_at IS NULL`,
        [taskId, actorId ?? null],
      );
      return await executor.query(
        `UPDATE tasks SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`,
        [taskId, actorId ?? null],
      );
    });
  }

  async listTaskStudents(filters: TaskStudentFilters): Promise<QueryResultRow[]> {
    let query = `
      SELECT DISTINCT ON (s.student_uuid)
        s.student_uuid AS id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS name,
        COALESCE(gl.label, 'ไม่ทราบ') AS grade,
        s."RoomID_Onec"::text AS room
      FROM student_term s
      LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filters.targetGrade) {
      params.push(filters.targetGrade);
      conditions.push(`gl.label = $${params.length}`);
    }

    if (filters.targetRoom) {
      params.push(Number.parseInt(filters.targetRoom, 10));
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }

    if (filters.targetSchoolId) {
      params.push(filters.targetSchoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY s.student_uuid ASC`;

    const result = await this.query<QueryResultRow>(query, params);
    return result.rows;
  }

  async listTaskHistory(
    date: string,
    targetGrade: string | null,
    targetRoom: string | null,
    targetSchoolId: number | null,
  ): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT DISTINCT ON (a.student_uuid)
        a.student_uuid AS student_id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
        a."AttendanceStatus" AS status
      FROM attendance a
      JOIN student_term s ON s.student_uuid = a.student_uuid
      WHERE a."AttendanceDate" = $1
        AND s."GradeLevelID_Onec" = (SELECT id FROM grade_levels WHERE label = $2)
        AND s."RoomID_Onec" = $3
        AND a."Period" = 1
        AND s."SchoolID_Onec" = $4
      ORDER BY a.student_uuid ASC
    `,
      [date, targetGrade, Number.parseInt(targetRoom || '0', 10), targetSchoolId],
    );

    return result.rows;
  }

  async findTaskChainTask(taskId: string, actor?: ActorContext): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        t.*,
        c.student_name,
        c.student_first_name,
        c.student_last_name,
        c.student_school,
        c.student_address,
        c.address_line,
        c.address_province,
        c.address_district,
        c.address_sub_district,
        c.postal_code,
        c.reason_flagged,
        c.status AS case_status,
        c.result_summary
      FROM tasks t
      LEFT JOIN cases c ON c.id = t.case_id AND c.deleted_at IS NULL
      WHERE t.id = $1
        AND t.deleted_at IS NULL
        AND (t.case_id IS NULL OR c.id IS NOT NULL)${scopeSql}
    `,
      [taskId, ...scopeQuery.params],
    );

    return result.rows[0] || null;
  }

  // Chain view — explicit safe column list (no token_hash / otp_code / otp_* /
  // assigned_to_phone / login_* ) to keep secrets out of the task-chain response.
  async listTaskLinksByTaskId(taskId: string): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.status,
        tl.created_at,
        tl.expires_at,
        tl.magic_link,
        tl.admin_locked,
        tl.delegation_depth,
        parent.assigned_to_name AS delegated_by_name,
        CASE WHEN tl.parent_link_id IS NULL THEN NULL ELSE tl.created_at END AS delegated_at
      FROM task_links tl
      LEFT JOIN task_links parent
        ON parent.id = tl.parent_link_id
        AND parent.task_id = tl.task_id
        AND parent.deleted_at IS NULL
      WHERE tl.task_id = $1
        AND tl.deleted_at IS NULL
      ORDER BY tl.delegation_depth ASC
    `,
      [taskId],
    );

    return result.rows;
  }

  // Chain view — explicit safe column list (no internal ids / audit columns /
  // raw updated_* fields) matching the TaskSubmission response contract.
  async findTaskSubmissionByLinkId(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        cause_category,
        cause_detail,
        recommendation,
        submitted_at,
        visit_lat,
        visit_lng,
        photo_paths
      FROM task_submissions
      WHERE task_link_id = $1
        AND deleted_at IS NULL
    `,
      [linkId],
    );

    return result.rows[0] || null;
  }

  async findTaskSubmissionContextByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id AS link_id,
        t.id AS task_id,
        t.case_id,
        t.task_type
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async insertTaskSubmission(data: TaskSubmissionInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_submissions (
        task_link_id,
        visit_lat,
        visit_lng,
        cause_category,
        cause_detail,
        recommendation,
        photo_paths,
        address_changed,
        updated_student_address,
        updated_lat,
        updated_lng
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
      [
        data.linkId,
        data.visitLat,
        data.visitLng,
        data.causeCategory,
        data.causeDetail,
        data.recommendation,
        data.photoPaths,
        data.addressChanged,
        data.updatedStudentAddress,
        data.updatedLat,
        data.updatedLng,
      ],
    );
  }

  async updateCaseAfterSubmission(
    data: CaseSubmissionUpdateInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    // Address text and coordinates update independently: COALESCE keeps the
    // existing value when a field is null, so a pin-only correction (coords with
    // no typed address) still saves student_lat/lng without wiping the address.
    await this.getExecutor(executor).query(
      `
        UPDATE cases
        SET
          status = $1,
          result_summary = $2,
          student_address = COALESCE($3, student_address),
          student_lat = COALESCE($4, student_lat),
          student_lng = COALESCE($5, student_lng)
        WHERE id = $6 AND deleted_at IS NULL
      `,
      [
        'PENDING_REVIEW',
        data.nextSummary,
        data.updatedStudentAddress,
        data.updatedLat,
        data.updatedLng,
        data.caseId,
      ],
    );
  }

  async updateTaskStatus(taskId: string, status: string, executor?: QueryExecutor): Promise<void> {
    // `deleted_at IS NULL` guard: if the task was tombstoned between an earlier
    // token validation and this write (submit/delegate race), the status change
    // no-ops instead of mutating a deleted row.
    await this.getExecutor(executor).query(
      `UPDATE tasks SET status = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [status, taskId],
    );
  }

  async updateTaskLinkStatus(
    linkId: string,
    status: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.getExecutor(executor).query(
      `UPDATE task_links SET status = $1 WHERE id = $2 AND deleted_at IS NULL`,
      [status, linkId],
    );
  }

  async transitionTaskLinkStatus(
    linkId: string,
    expectedStatus: string,
    nextStatus: string,
    executor: QueryExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE task_links
       SET status = $1
       WHERE id = $2 AND status = $3 AND deleted_at IS NULL
       RETURNING id`,
      [nextStatus, linkId, expectedStatus],
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }

  async lockDelegationLinkForUpdate(
    linkId: string,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await executor.query(
      `SELECT
         tl.id,
         tl.task_id,
         tl.assigned_to_name,
         tl.expires_at,
         tl.status,
         tl.admin_locked,
         tl.delegation_depth,
         t.max_delegation_depth
       FROM task_links tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE tl.id = $1
         AND tl.deleted_at IS NULL
         AND t.deleted_at IS NULL
       FOR UPDATE OF tl`,
      [linkId],
    );
    return result.rows[0] || null;
  }

  /**
   * Lock a link row and confirm the link + its parent task are both live.
   * Returns null if either is tombstoned. Call at the start of a submit/write
   * transaction so an admin delete that commits after token validation can't be
   * raced: deleteTask's UPDATE and this `FOR UPDATE` serialize on the same row.
   */
  async lockLiveTaskLink(linkId: string, executor: QueryExecutor): Promise<QueryResultRow | null> {
    const result = await executor.query(
      `SELECT tl.id
       FROM task_links tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE tl.id = $1
         AND tl.deleted_at IS NULL
         AND t.deleted_at IS NULL
       FOR UPDATE OF tl`,
      [linkId],
    );
    return result.rows[0] || null;
  }

  async findStudentTermMetadata(
    studentUuid: string,
    executor?: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
      SELECT
        "SchoolID_Onec",
        "GradeLevelID_Onec",
        "RoomID_Onec",
        "Semester_Onec",
        "AcademicYear_Onec"
      FROM student_term
      WHERE student_uuid = $1
    `,
      [studentUuid],
    );

    return result.rows[0] || null;
  }

  async findSchoolById(schoolId: number, executor?: QueryExecutor): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
      SELECT id, province, district, sub_district
      FROM schools
      WHERE id = $1
      LIMIT 1
    `,
      [schoolId],
    );

    return result.rows[0] || null;
  }

  async replaceAttendanceRecord(
    data: AttendanceReplaceInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);

    await queryExecutor.query(
      `
      DELETE FROM attendance
      WHERE "AttendanceDate" = $1 AND student_uuid = $2
    `,
      [data.attendanceDate, data.studentUuid],
    );

    await queryExecutor.query(
      `
      INSERT INTO attendance (
        student_uuid,
        "SchoolID_Onec",
        "GradeLevelID_Onec",
        "RoomID_Onec",
        "AttendanceDate",
        "Semester_Onec",
        "AcademicYear_Onec",
        "AttendanceStatus",
        "Period",
        "RecordedBy"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        data.studentUuid,
        data.schoolId,
        data.gradeLevelId,
        data.roomId,
        data.attendanceDate,
        data.semester,
        data.academicYear,
        data.attendanceStatus,
        1,
        data.recordedBy,
      ],
    );
  }

  async getSystemSettingValue(settingKey: string): Promise<string | null> {
    const result = await this.query<SettingValueRow>(
      `SELECT setting_value FROM system_settings WHERE setting_key = $1`,
      [settingKey],
    );

    if (!result.rowCount || result.rowCount <= 0) {
      return null;
    }

    const value = result.rows[0]?.setting_value;
    return this.normalizeScalar(value) || null;
  }

  async findOtpLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id,
        tl.assigned_to_email,
        tl.otp_code,
        tl.otp_expires_at,
        tl.otp_attempts,
        tl.otp_locked_until
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  /**
   * Same as findOtpLinkByTokenHash but takes a row lock (FOR UPDATE) so the OTP
   * verify path (lock-check → compare → increment/clear) runs serialized within
   * a transaction. Without this, concurrent guesses could each read the row
   * before the lock is set and slip past the attempt cap.
   */
  async findOtpLinkByTokenHashForUpdate(
    tokenHash: string,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await executor.query(
      `
      SELECT
        tl.id,
        tl.otp_code,
        tl.otp_expires_at,
        tl.otp_attempts,
        tl.otp_locked_until
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
      FOR UPDATE OF tl
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async updateLinkOtp(data: TaskLinkOtpInput, executor?: QueryExecutor): Promise<void> {
    // Issuing a fresh OTP resets the brute-force counter and clears any lockout:
    // a new code is a new challenge, so the previous failed guesses no longer apply.
    await this.getExecutor(executor).query(
      `
      UPDATE task_links
      SET otp_code = $1, otp_expires_at = $2, otp_verified = 0,
          otp_attempts = 0, otp_locked_until = NULL
      WHERE id = $3
    `,
      [data.otpCode, data.otpExpiresAt, data.linkId],
    );
  }

  /**
   * Record one failed OTP guess and lock the link once `maxAttempts` is reached.
   * The increment + conditional lock happen in a single UPDATE so concurrent
   * guesses cannot race past the cap. Returns the new attempt count and lock time.
   */
  async registerFailedOtpAttempt(
    linkId: string,
    maxAttempts: number,
    lockSeconds: number,
    executor?: QueryExecutor,
  ): Promise<{ attempts: number; lockedUntil: Date | null }> {
    const result = await this.getExecutor(executor).query(
      `
      UPDATE task_links
      SET otp_attempts = otp_attempts + 1,
          otp_locked_until = CASE
            WHEN otp_attempts + 1 >= $2 THEN now() + ($3 || ' seconds')::interval
            ELSE otp_locked_until
          END
      WHERE id = $1
      RETURNING otp_attempts, otp_locked_until
    `,
      [linkId, maxAttempts, lockSeconds],
    );
    const row = result.rows[0] as
      | { otp_attempts: number; otp_locked_until: Date | null }
      | undefined;
    return {
      attempts: Number(row?.otp_attempts ?? 0),
      lockedUntil: row?.otp_locked_until ? new Date(String(row.otp_locked_until)) : null,
    };
  }

  /** Clear the OTP brute-force counter after a successful verification. */
  async clearOtpAttempts(linkId: string, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `UPDATE task_links SET otp_attempts = 0, otp_locked_until = NULL WHERE id = $1`,
      [linkId],
    );
  }

  async findTaskLinkById(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.id = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [linkId],
    );

    return result.rows[0] || null;
  }

  /**
   * Admin link detail by id — explicit safe column list (no token_hash / otp_code)
   * plus school name. Returns the row regardless of locked/expired status so the
   * admin detail page can render and manage a closed link.
   */
  async findLinkDetailById(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id,
        tl.task_id,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.expires_at,
        tl.status,
        tl.magic_link,
        tl.admin_locked,
        tl.admin_lock_reason,
        tl.subject,
        tl.login_role,
        tl.login_permissions,
        tl.login_data_scope,
        tl.first_used_at,
        r.label AS login_role_label,
        t.created_at,
        t.task_type,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        s.name AS school_name
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      LEFT JOIN roles r ON r.name = COALESCE(NULLIF(TRIM(tl.login_role), ''), 'TEACHER')
      WHERE tl.id = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [linkId],
    );

    return result.rows[0] || null;
  }

  async updateAdminLockState(data: AdminLockUpdateInput, executor?: QueryExecutor): Promise<void> {
    if (data.locked) {
      await this.getExecutor(executor).query(
        `
        UPDATE task_links
        SET admin_locked = 1, admin_lock_reason = $1, admin_lock_at = $2
        WHERE id = $3
      `,
        [data.reason || null, data.lockedAt || null, data.linkId],
      );
      return;
    }

    await this.getExecutor(executor).query(
      `
      UPDATE task_links
      SET admin_locked = 0, admin_lock_reason = NULL, admin_lock_at = NULL
      WHERE id = $1
    `,
      [data.linkId],
    );
  }

  async listCasesWithActiveLinks(
    actor?: ActorContext,
    filters: CaseListFilters = {},
  ): Promise<{ rows: QueryResultRow[]; totalCount: number; statusCounts: Record<string, number> }> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`c.status = $${params.length}`);
    }

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`c.student_name ILIKE $${params.length}`);
    }

    if (filters.province) {
      params.push(filters.province);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.province = $${params.length})`,
      );
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.district = $${params.length})`,
      );
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.sub_district = $${params.length})`,
      );
    }

    if (filters.schoolId) {
      params.push(filters.schoolId);
      conditions.push(`c.school_id = $${params.length}`);
    }

    if (filters.grade || filters.room) {
      const classConditions = [
        `LOWER(TRIM(CONCAT_WS(' ', case_student."FirstName_Onec", case_student."LastName_Onec"))) = LOWER(TRIM(c.student_name))`,
        `(
          NULLIF(TRIM(COALESCE(c.student_school, '')), '') IS NULL
          OR LOWER(COALESCE(case_school.name, '')) = LOWER(COALESCE(c.student_school, ''))
        )`,
      ];
      if (filters.grade) {
        params.push(filters.grade);
        classConditions.push(`case_grade.label = $${params.length}`);
      }
      if (filters.room) {
        params.push(filters.room);
        classConditions.push(`case_student."RoomID_Onec"::text = $${params.length}`);
      }
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_student
          LEFT JOIN schools case_school ON case_school.id = case_student."SchoolID_Onec"
          LEFT JOIN grade_levels case_grade ON case_grade.id = case_student."GradeLevelID_Onec"
          WHERE ${classConditions.join(' AND ')}
        )
      `);
    }

    const scopeQuery = this.buildCaseScopeQuery(actor, params.length + 1);
    if (scopeQuery.sql) {
      conditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    conditions.push('c.deleted_at IS NULL');

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // The list fans out one row per (case, task); count joins tasks the same way
    // so the total matches the rows actually paged.
    const countResult = await this.query<CountRow>(
      `SELECT count(*) FROM cases c LEFT JOIN tasks t ON t.case_id = c.id AND t.deleted_at IS NULL ${whereSql}`,
      params,
    );
    const totalCount = Number.parseInt(String(countResult.rows[0]?.count || '0'), 10);

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;

    const selectParams = [...params, limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;

    const result = await this.query<QueryResultRow>(
      `
      SELECT
        c.id,
        c.student_name,
        c.student_first_name,
        c.student_last_name,
        c.student_school,
        c.student_address,
        c.address_line,
        c.address_province,
        c.address_district,
        c.address_sub_district,
        c.postal_code,
        c.reason_flagged,
        c.status,
        c.created_at,
        student_match.student_id,
        t.id AS task_id,
        tl.id AS active_link_id,
        tl.magic_link AS active_link,
        tl.admin_locked AS active_link_locked,
        tl.admin_lock_reason AS active_link_lock_reason,
        tl.created_at AS active_link_created_at,
        tl.expires_at AS active_link_expires_at,
        tl.assigned_to_name AS active_link_assigned_to,
        tl.delegation_depth AS active_link_depth,
        COALESCE(link_state_snapshot.link_state, 'NONE') AS link_state
      FROM cases c
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) = 1 THEN (array_agg(candidate.student_uuid))[1]
            ELSE NULL
          END AS student_id
        FROM (
          SELECT DISTINCT s.student_uuid
          FROM student_term s
          LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
          WHERE LOWER(TRIM(CONCAT_WS(' ', s."FirstName_Onec", s."LastName_Onec"))) = LOWER(TRIM(c.student_name))
            AND (
              NULLIF(TRIM(COALESCE(c.student_school, '')), '') IS NULL
              OR LOWER(COALESCE(sc.name, '')) = LOWER(COALESCE(c.student_school, ''))
            )
        ) candidate
      ) student_match ON true
      LEFT JOIN tasks t ON t.case_id = c.id AND t.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN latest_active_link.expires_at <= NOW() THEN 'EXPIRED'
            WHEN latest_active_link.admin_locked = 1 THEN 'LOCKED'
            ELSE 'ACTIVE'
          END AS link_state
        FROM task_links latest_active_link
        WHERE latest_active_link.task_id = t.id
          AND latest_active_link.status = 'ACTIVE'
          AND latest_active_link.deleted_at IS NULL
        ORDER BY latest_active_link.delegation_depth DESC, latest_active_link.created_at DESC
        LIMIT 1
      ) link_state_snapshot ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM task_links
        WHERE task_id = t.id
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
        ORDER BY delegation_depth DESC
        LIMIT 1
      ) tl ON true
      ${whereSql}
      ORDER BY c.created_at DESC, c.id DESC, t.id DESC NULLS LAST
      LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
    `,
      selectParams,
    );

    const statusCounts = await this.countCaseStatuses(actor, { ...filters, status: undefined });

    return { rows: result.rows, totalCount, statusCounts };
  }

  async countCaseStatuses(
    actor?: ActorContext,
    filters: CaseListFilters = {},
  ): Promise<Record<string, number>> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`c.student_name ILIKE $${params.length}`);
    }

    if (filters.province) {
      params.push(filters.province);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.province = $${params.length})`,
      );
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.district = $${params.length})`,
      );
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.sub_district = $${params.length})`,
      );
    }

    if (filters.schoolId) {
      params.push(filters.schoolId);
      conditions.push(`c.school_id = $${params.length}`);
    }

    if (filters.grade || filters.room) {
      const classConditions = [
        `LOWER(TRIM(CONCAT_WS(' ', case_student."FirstName_Onec", case_student."LastName_Onec"))) = LOWER(TRIM(c.student_name))`,
        `(
          NULLIF(TRIM(COALESCE(c.student_school, '')), '') IS NULL
          OR LOWER(COALESCE(case_school.name, '')) = LOWER(COALESCE(c.student_school, ''))
        )`,
      ];
      if (filters.grade) {
        params.push(filters.grade);
        classConditions.push(`case_grade.label = $${params.length}`);
      }
      if (filters.room) {
        params.push(filters.room);
        classConditions.push(`case_student."RoomID_Onec"::text = $${params.length}`);
      }
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_student
          LEFT JOIN schools case_school ON case_school.id = case_student."SchoolID_Onec"
          LEFT JOIN grade_levels case_grade ON case_grade.id = case_student."GradeLevelID_Onec"
          WHERE ${classConditions.join(' AND ')}
        )
      `);
    }

    const scopeQuery = this.buildCaseScopeQuery(actor, params.length + 1);
    if (scopeQuery.sql) {
      conditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    conditions.push('c.deleted_at IS NULL');
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.query<CaseStatusCountRow>(
      `
        SELECT c.status, COUNT(*)::int AS count
        FROM cases c
        ${whereSql}
        GROUP BY c.status
      `,
      params,
    );
    return result.rows.reduce<Record<string, number>>(
      (counts, row) => ({
        ...counts,
        [row.status]: Number.parseInt(String(row.count || '0'), 10),
      }),
      {},
    );
  }

  async countCases(status?: string, actor?: ActorContext): Promise<number> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    const scopeQuery = this.buildCaseScopeQuery(actor, params.length + 1);
    if (scopeQuery.sql) {
      conditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    conditions.push('c.deleted_at IS NULL');

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.query<CountRow>(`SELECT count(*) FROM cases c ${whereSql}`, params);

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countAtRiskStudents(actor?: ActorContext): Promise<number> {
    const activeStatuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_HELP', 'PENDING_REVIEW'];
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<CountRow>(
      `
      SELECT count(DISTINCT CASE
        WHEN c.student_uuid IS NOT NULL THEN 'uuid:' || c.student_uuid::text
        WHEN NULLIF(TRIM(COALESCE(c.student_name, '')), '') IS NOT NULL THEN
          CONCAT('legacy:', COALESCE(c.school_id::text, 'unknown'), ':', LOWER(TRIM(c.student_name)))
        ELSE 'case:' || c.id::text
      END)
      FROM cases c
      WHERE c.status = ANY($1::text[])
        AND c.deleted_at IS NULL${scopeSql}
    `,
      [activeStatuses, ...scopeQuery.params],
    );

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countCasesCreatedOn(date: string, actor?: ActorContext): Promise<number> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM cases c WHERE c.created_at::date = $1 AND c.deleted_at IS NULL${scopeSql}`,
      [date, ...scopeQuery.params],
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countActiveTaskLinks(actor?: ActorContext): Promise<number> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 1);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<CountRow>(
      `
      SELECT count(*)
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      JOIN cases c ON c.id = t.case_id
      WHERE tl.status = 'ACTIVE'
        AND tl.expires_at > NOW()
        AND c.deleted_at IS NULL
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL${scopeSql}
    `,
      scopeQuery.params,
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  // Overview totals must respect the actor's data scope — a province admin's
  // "total students" is their province, not the whole country. student_term
  // scopes via the schools join (province/district live on schools); the
  // dropouts table carries the area names on its own columns.
  async countStudents(actor?: ActorContext): Promise<number> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (actor?.data_scope) {
      const scopeResult = buildDataScopeQuery(
        actor.data_scope,
        {
          school_id: `s."SchoolID_Onec"`,
          grade: `s."GradeLevelID_Onec"`,
          room: `s."RoomID_Onec"::text`,
          province: 'sc.province',
          district: 'sc.district',
          sub_district: 'sc.sub_district',
        },
        params.length + 1,
      );
      if (scopeResult.sql) {
        conditions.push(`(${scopeResult.sql})`);
        params.push(...scopeResult.params);
      }
    }
    // own_only with no area scope (e.g. a student self-login) owns no student
    // rows — never fall through to a national total.
    if (actor?.data_scope?.own_only === true && conditions.length === 0) {
      return 0;
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM student_term s
       LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id ${whereSql}`,
      params,
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countStudentDropouts(actor?: ActorContext): Promise<number> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (actor?.data_scope) {
      const scopeResult = buildDataScopeQuery(
        actor.data_scope,
        {
          school_id: `"SchoolID_Onec"`,
          grade: `"GradeLevelID_Onec"`,
          room: `"RoomID_Onec"::text`,
          province: `"ProvinceNameThai_Onec"`,
          district: `"DistrictNameThai_Onec"`,
          sub_district: `"SubDistrictNameThai_Onec"`,
        },
        params.length + 1,
      );
      if (scopeResult.sql) {
        conditions.push(`(${scopeResult.sql})`);
        params.push(...scopeResult.params);
      }
    }
    if (actor?.data_scope?.own_only === true && conditions.length === 0) {
      return 0;
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM student_dropouts ${whereSql}`,
      params,
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async findDelegationLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        t.max_delegation_depth
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async createDelegatedTaskLink(
    data: CreateTaskLinkInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.createTaskLink(data, executor);
  }

  async insertCaseReview(data: CaseReviewInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO case_reviews (
        id,
        case_id,
        review_action,
        review_note,
        resolution_outcome,
        reviewed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [
        data.reviewId,
        data.caseId,
        data.reviewAction,
        data.reviewNote,
        data.resolutionOutcome,
        data.reviewedBy,
      ],
    );
  }

  async findEligibleReferralAgency(
    agencyId: number,
    caseId: number,
    executor?: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
      SELECT
        a.id,
        a.name,
        a.agency_type,
        a.province,
        a.district,
        a.sub_district,
        a.phone,
        a.contact_person,
        a.address
      FROM external_agencies a
      JOIN cases c ON c.id = $2 AND c.deleted_at IS NULL
      LEFT JOIN schools s ON s.id = c.school_id
      WHERE a.id = $1
        AND a.is_active = TRUE
        AND a.deleted_at IS NULL
        AND (a.province IS NULL OR a.province = s.province)
        AND (a.district IS NULL OR a.district = s.district)
        AND (a.sub_district IS NULL OR a.sub_district = s.sub_district)
      LIMIT 1
    `,
      [agencyId, caseId],
    );

    return result.rows[0] || null;
  }

  async listReferralAgenciesForCase(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        a.id,
        a.name,
        a.agency_type,
        a.province,
        a.district,
        a.sub_district,
        a.phone,
        a.contact_person,
        a.address
      FROM external_agencies a
      JOIN cases c ON c.id = $1 AND c.deleted_at IS NULL
      LEFT JOIN schools s ON s.id = c.school_id
      WHERE a.is_active = TRUE
        AND a.deleted_at IS NULL
        AND (a.province IS NULL OR a.province = s.province)
        AND (a.district IS NULL OR a.district = s.district)
        AND (a.sub_district IS NULL OR a.sub_district = s.sub_district)
      ORDER BY a.agency_type ASC, a.name ASC
    `,
      [caseId],
    );

    return result.rows;
  }

  async insertCaseReferral(data: CaseReferralInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO case_referrals (
        id,
        case_id,
        agency_id,
        agency_name_snapshot,
        agency_type_snapshot,
        referred_by,
        referred_by_label,
        referral_note,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    `,
      [
        data.referralId,
        data.caseId,
        data.agencyId,
        data.agencyName,
        data.agencyType,
        data.referredBy,
        data.referredByLabel,
        data.referralNote,
        data.createdBy,
      ],
    );
  }

  async listCaseReferrals(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        r.id,
        r.case_id,
        r.agency_id,
        r.agency_name_snapshot,
        r.agency_type_snapshot,
        r.referred_by,
        r.referred_by_label,
        r.referred_at,
        r.referral_note,
        r.status,
        r.outcome,
        r.responded_at,
        a.phone,
        a.contact_person,
        a.address
      FROM case_referrals r
      LEFT JOIN external_agencies a ON a.id = r.agency_id
      WHERE r.case_id = $1
        AND r.deleted_at IS NULL
      ORDER BY r.referred_at DESC
    `,
      [caseId],
    );

    return result.rows;
  }

  async findCaseReferralById(
    referralId: string,
    actor?: ActorContext,
  ): Promise<QueryResultRow | null> {
    const scope = this.buildCaseScopeQuery(actor, 2, 'c');
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        r.id,
        r.case_id,
        r.agency_id,
        r.agency_name_snapshot,
        r.agency_type_snapshot,
        r.referred_by,
        r.referred_by_label,
        r.referred_at,
        r.referral_note,
        r.status,
        r.outcome,
        r.responded_at
      FROM case_referrals r
      JOIN cases c ON c.id = r.case_id AND c.deleted_at IS NULL
      WHERE r.id = $1
        AND r.deleted_at IS NULL
        ${scope.sql ? `AND ${scope.sql}` : ''}
      LIMIT 1
    `,
      [referralId, ...scope.params],
    );

    return result.rows[0] || null;
  }

  async updateCaseReferralOutcome(
    data: CaseReferralOutcomeInput,
    executor?: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
      UPDATE case_referrals
      SET
        status = $2,
        outcome = $3,
        responded_at = now(),
        updated_by = $4
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING
        id,
        case_id,
        agency_id,
        agency_name_snapshot,
        agency_type_snapshot,
        referred_by,
        referred_by_label,
        referred_at,
        referral_note,
        status,
        outcome,
        responded_at
    `,
      [data.referralId, data.status, data.outcome, data.updatedBy],
    );

    return result.rows[0] || null;
  }

  async findCaseReviewById(reviewId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT *
      FROM case_reviews
      WHERE id = $1
      LIMIT 1
    `,
      [reviewId],
    );

    return result.rows[0] || null;
  }

  async listTasksByCase(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        t.id AS task_id,
        t.created_at,
        tl.assigned_to_name AS initial_assignee,
        (SELECT COUNT(*) FROM task_links WHERE task_id = t.id AND deleted_at IS NULL) AS link_count,
        EXISTS(
          SELECT 1
          FROM task_links tl2
          JOIN task_submissions ts ON ts.task_link_id = tl2.id
          WHERE tl2.task_id = t.id
            AND tl2.deleted_at IS NULL
            AND ts.deleted_at IS NULL
        ) AS has_submission
      FROM tasks t
      LEFT JOIN task_links tl ON tl.task_id = t.id AND tl.delegation_depth = 0 AND tl.deleted_at IS NULL
      WHERE t.case_id = $1
        AND t.deleted_at IS NULL
      ORDER BY t.created_at ASC
    `,
      [caseId],
    );

    return result.rows;
  }

  async listCaseReviews(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT *
      FROM case_reviews
      WHERE case_id = $1
      ORDER BY reviewed_at DESC
    `,
      [caseId],
    );

    return result.rows;
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
    };
  }
}
