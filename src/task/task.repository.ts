import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { appConfig } from '../config/app.config';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  QueryResultLike,
  QueryResultRow,
  RiskDashboardFilters,
  RiskDashboardResult,
  RiskDashboardRow,
  RiskDashboardSummary,
  RiskDashboardThresholds,
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

const EMPTY_RISK_DASHBOARD_SUMMARY: RiskDashboardSummary = {
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  WATCH: 0,
  NORMAL: 0,
};

interface RiskDashboardSummaryRow extends QueryResultRow, RiskDashboardSummary {
  total_count: number | string;
  missing_profile_count?: number | string;
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
  scheduled: number;
}

export interface VisitLinkListFilters {
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

export interface VisitLinkSummary {
  total: number;
  active: number;
  locked: number;
  expired: number;
  scheduled: number;
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
  /** AES-256-GCM ciphertext of the raw token (see TokenEncryptionService). */
  tokenEncrypted: string;
  delegationDepth: number;
  assignedToName: string;
  assignedToPhone: string | null;
  assignedToEmail: string | null;
  expiresAt: string;
  /** Optional future open time; null = usable immediately. */
  opensAt: string | null;
  subject: string | null;
  subjectId: number | null;
  sourceFieldFollowerId: number | null;
  otpVerified: number;
  createdBy: number | null;
  loginRole: string | null;
  loginPermissions: string[];
  loginDataScope: DataScope | Record<string, unknown>;
}

export interface FollowUpTaskAssignmentRow extends QueryResultRow {
  id: string;
  student_uuid: string;
  school_id: number | string;
  status: string;
  assigned_task_id: string | null;
  assigned_by: number | string | null;
  assigned_at: Date | string | null;
  assigned_case_id: number | string | null;
  opened_case_id: number | string | null;
  assigned_link_token_encrypted: string | null;
  assigned_link_expires_at: Date | string | null;
}

interface TaskLinkTimetableSlotRow extends QueryResultRow {
  id: number | string;
  school_id: number | string;
  grade_level_id: number | string;
  grade_label: string;
  room_no: number | string;
  subject_id: number | string;
  subject_name_th?: string | null;
  teacher_name?: string | null;
  day_of_week: number | string;
  period: number | string;
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly tokenEncryption: TokenEncryptionService,
    @Inject(appConfig.KEY)
    private readonly appRuntimeConfig: ConfigType<typeof appConfig>,
  ) {}

  /**
   * Reconstruct a magic-login URL from its encrypted-at-rest token. Reads
   * never had a live `Request` to fall back to a request host (unlike link
   * creation), so this always uses the configured FRONTEND_BASE_URL — falling
   * back to a relative `/task/:token` path when unset, which the frontend's
   * own `normalizeTaskPublicLink()` already resolves onto the current origin.
   * Returns null for rows with no link yet (e.g. a task with no active link).
   */
  private resolveMagicLink(tokenEncrypted: string | null | undefined): string | null {
    if (!tokenEncrypted) return null;
    const token = this.tokenEncryption.decrypt(tokenEncrypted);
    return `${this.appRuntimeConfig.frontendBaseUrl ?? ''}/task/${token}`;
  }

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

  /**
   * Atomically claim overdue home-visit links: still ACTIVE, past their expiry,
   * not yet flagged. The single UPDATE…RETURNING both marks and returns them, so
   * a reminder is sent at most once even if the job overlaps.
   */
  async claimOverdueTaskLinks(cutoff: Date): Promise<
    Array<{
      id: string;
      task_id: string | null;
      created_by: number | null;
      assigned_to_name: string | null;
    }>
  > {
    const result = await this.query<QueryResultRow>(
      `
        UPDATE task_links
        SET overdue_notified_at = now(), updated_at = now()
        WHERE status = 'ACTIVE'
          AND expires_at < $1
          AND overdue_notified_at IS NULL
          AND deleted_at IS NULL
          AND created_by IS NOT NULL
        RETURNING id, task_id, created_by, assigned_to_name
      `,
      [cutoff.toISOString()],
    );
    return result.rows.map((row) => ({
      id: typeof row.id === 'string' ? row.id : '',
      task_id: typeof row.task_id === 'string' ? row.task_id : null,
      created_by:
        typeof row.created_by === 'number'
          ? row.created_by
          : typeof row.created_by === 'string'
            ? Number(row.created_by)
            : null,
      assigned_to_name: typeof row.assigned_to_name === 'string' ? row.assigned_to_name : null,
    }));
  }

  async claimCaseSlaWarnings(now: Date): Promise<
    Array<{
      id: number;
      student_name: string | null;
      school_id: number | null;
      risk_tier: string | null;
      sla_due_at: Date | string | null;
    }>
  > {
    const result = await this.query<QueryResultRow>(
      `
        WITH claimed AS (
          UPDATE cases c
          SET sla_warning_notified_at = now(), updated_at = now()
          WHERE c.deleted_at IS NULL
            AND c.status NOT IN ('RESOLVED', 'CANCELLED')
            AND c.sla_due_at IS NOT NULL
            AND c.sla_warning_notified_at IS NULL
            AND $1::timestamptz >= c.created_at + ((c.sla_due_at - c.created_at) * 0.8)
            AND $1::timestamptz < c.sla_due_at
          RETURNING c.id, c.student_name, c.school_id, c.risk_tier, c.sla_due_at
        ), audit_insert AS (
          INSERT INTO audit_log (
            actor_user_id,
            actor_label,
            action,
            target_type,
            target_id,
            metadata,
            ip
          )
          SELECT
            NULL,
            'system:case-sla-reminder',
            'CASE_SLA_WARNING',
            'case',
            claimed.id::text,
            jsonb_build_object(
              'riskTier', claimed.risk_tier,
              'slaDueAt', claimed.sla_due_at,
              'schoolId', claimed.school_id
            ),
            NULL
          FROM claimed
          RETURNING 1
        )
        SELECT id, student_name, school_id, risk_tier, sla_due_at FROM claimed
      `,
      [now.toISOString()],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      student_name: typeof row.student_name === 'string' ? row.student_name : null,
      school_id:
        typeof row.school_id === 'number'
          ? row.school_id
          : typeof row.school_id === 'string'
            ? Number(row.school_id)
            : null,
      risk_tier: typeof row.risk_tier === 'string' ? row.risk_tier : null,
      sla_due_at:
        row.sla_due_at instanceof Date || typeof row.sla_due_at === 'string'
          ? row.sla_due_at
          : null,
    }));
  }

  async claimCaseSlaBreaches(now: Date): Promise<
    Array<{
      id: number;
      student_name: string | null;
      school_id: number | null;
      risk_tier: string | null;
      sla_due_at: Date | string | null;
    }>
  > {
    const result = await this.query<QueryResultRow>(
      `
        WITH claimed AS (
          UPDATE cases c
          SET sla_breached_notified_at = now(), updated_at = now()
          WHERE c.deleted_at IS NULL
            AND c.status NOT IN ('RESOLVED', 'CANCELLED')
            AND c.sla_due_at IS NOT NULL
            AND c.sla_breached_notified_at IS NULL
            AND c.sla_due_at < $1::timestamptz
          RETURNING c.id, c.student_name, c.school_id, c.risk_tier, c.sla_due_at
        ), audit_insert AS (
          INSERT INTO audit_log (
            actor_user_id,
            actor_label,
            action,
            target_type,
            target_id,
            metadata,
            ip
          )
          SELECT
            NULL,
            'system:case-sla-reminder',
            'CASE_SLA_BREACHED',
            'case',
            claimed.id::text,
            jsonb_build_object(
              'riskTier', claimed.risk_tier,
              'slaDueAt', claimed.sla_due_at,
              'schoolId', claimed.school_id
            ),
            NULL
          FROM claimed
          RETURNING 1
        )
        SELECT id, student_name, school_id, risk_tier, sla_due_at FROM claimed
      `,
      [now.toISOString()],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      student_name: typeof row.student_name === 'string' ? row.student_name : null,
      school_id:
        typeof row.school_id === 'number'
          ? row.school_id
          : typeof row.school_id === 'string'
            ? Number(row.school_id)
            : null,
      risk_tier: typeof row.risk_tier === 'string' ? row.risk_tier : null,
      sla_due_at:
        row.sla_due_at instanceof Date || typeof row.sla_due_at === 'string'
          ? row.sla_due_at
          : null,
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
      SELECT id, school_id, student_uuid::text
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
        token_encrypted,
        delegation_depth,
        assigned_to_name,
        assigned_to_phone,
        assigned_to_email,
        expires_at,
        subject,
        subject_id,
        otp_verified,
        created_by,
        updated_by,
        login_role,
        login_permissions,
        login_data_scope,
        opens_at,
        source_field_follower_id
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
        $14,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19
      )
    `,
      [
        data.linkId,
        data.taskId,
        data.parentLinkId,
        data.tokenHash,
        data.tokenEncrypted,
        data.delegationDepth,
        data.assignedToName,
        data.assignedToPhone,
        data.assignedToEmail,
        data.expiresAt,
        data.subject,
        data.subjectId,
        data.otpVerified,
        data.createdBy,
        data.loginRole,
        JSON.stringify(data.loginPermissions),
        JSON.stringify(data.loginDataScope),
        data.opensAt,
        data.sourceFieldFollowerId,
      ],
    );
  }

  async lockFollowUpTaskAssignment(
    requestId: string,
    executor: QueryExecutor,
  ): Promise<FollowUpTaskAssignmentRow | null> {
    const result = await executor.query<FollowUpTaskAssignmentRow>(
      `SELECT request.id,
              request.student_uuid::text,
              request.school_id,
              request.status,
              request.assigned_task_id::text,
              request.assigned_by,
              request.assigned_at,
              request.opened_case_id,
              task.case_id AS assigned_case_id,
              root_link.token_encrypted AS assigned_link_token_encrypted,
              root_link.expires_at AS assigned_link_expires_at
       FROM student_follow_up_requests request
       LEFT JOIN tasks task
         ON task.id = request.assigned_task_id
        AND task.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT link.token_encrypted, link.expires_at
         FROM task_links link
         WHERE link.task_id = request.assigned_task_id
           AND link.parent_link_id IS NULL
           AND link.deleted_at IS NULL
         ORDER BY link.created_at ASC, link.id ASC
         LIMIT 1
       ) root_link ON TRUE
       WHERE request.id = $1
       LIMIT 1
       FOR UPDATE OF request`,
      [requestId],
    );
    return result.rows[0] ?? null;
  }

  async markFollowUpTaskAssigned(
    requestId: string,
    taskId: string,
    actorId: number,
    executor: QueryExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE student_follow_up_requests
       SET assigned_task_id = $2,
           assigned_by = $3,
           assigned_at = now(),
           revision_number = revision_number + 1
       WHERE id = $1
         AND status = 'APPROVED'
         AND assigned_task_id IS NULL
       RETURNING id`,
      [requestId, taskId, actorId],
    );
    return (result.rowCount ?? result.rows.length) === 1;
  }

  async assignFollowerCampaignTarget(
    data: {
      campaignTargetId: number;
      sourceFieldFollowerId: number;
      taskLinkId: string;
      caseId: number;
      actorId: number | null;
    },
    executor?: QueryExecutor,
  ): Promise<boolean> {
    const result = await this.getExecutor(executor).query(
      `
        UPDATE follower_recruitment_campaign_targets target
        SET
          status = 'ASSIGNED',
          assigned_follower_id = $2,
          assigned_task_link_id = $3,
          assigned_at = now(),
          assigned_by = $5,
          updated_by = $5,
          updated_at = now()
        WHERE target.id = $1
          AND target.case_id = $4
          AND target.status = 'OPEN'
          AND target.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM field_followers follower
            WHERE follower.id = $2
              AND follower.campaign_id = target.campaign_id
              AND follower.status = 'ACTIVE'
              AND follower.email IS NOT NULL
          )
        RETURNING target.id
      `,
      [
        data.campaignTargetId,
        data.sourceFieldFollowerId,
        data.taskLinkId,
        data.caseId,
        data.actorId,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listTimetableSlotsForTaskLink(
    slotIds: number[],
    executor?: QueryExecutor,
  ): Promise<TaskLinkTimetableSlotRow[]> {
    if (slotIds.length === 0) {
      return [];
    }

    const result = await this.getExecutor(executor).query<TaskLinkTimetableSlotRow>(
      `
        SELECT
          ts.id,
          ts.school_id,
          ts.grade_level_id,
          gl.label AS grade_label,
          ts.room_no,
          ts.subject_id,
          ts.day_of_week,
          ts.period
        FROM timetable_slots ts
        JOIN grade_levels gl ON gl.id = ts.grade_level_id
        WHERE ts.id = ANY($1::bigint[])
          AND ts.deleted_at IS NULL
        ORDER BY array_position($1::bigint[], ts.id)
      `,
      [slotIds],
    );
    return result.rows;
  }

  async insertTaskLinkTimetableSlots(
    linkId: string,
    slotIds: number[],
    actorUserId: number | null,
    executor?: QueryExecutor,
  ): Promise<void> {
    if (slotIds.length === 0) {
      return;
    }

    await this.getExecutor(executor).query(
      `
        INSERT INTO task_link_timetable_slots (
          task_link_id,
          timetable_slot_id,
          created_by,
          updated_by
        )
        SELECT $1, slot_id, $3, $3
        FROM unnest($2::bigint[]) AS slot_id
      `,
      [linkId, slotIds, actorUserId],
    );
  }

  async listLinkedTimetableSlots(
    linkId: string,
    executor?: QueryExecutor,
  ): Promise<TaskLinkTimetableSlotRow[]> {
    const result = await this.getExecutor(executor).query<TaskLinkTimetableSlotRow>(
      `
        SELECT
          ts.id,
          ts.school_id,
          ts.grade_level_id,
          gl.label AS grade_label,
          ts.room_no,
          ts.subject_id,
          sub.name_th AS subject_name_th,
          NULLIF(TRIM(COALESCE(teacher."FirstName", '') || ' ' || COALESCE(teacher."LastName", '')), '') AS teacher_name,
          ts.day_of_week,
          ts.period
        FROM task_link_timetable_slots link_slot
        JOIN timetable_slots ts ON ts.id = link_slot.timetable_slot_id
        JOIN grade_levels gl ON gl.id = ts.grade_level_id
        JOIN subjects sub ON sub.id = ts.subject_id
        LEFT JOIN users teacher ON teacher.id = ts.teacher_user_id
        WHERE link_slot.task_link_id = $1
          AND link_slot.deleted_at IS NULL
        ORDER BY ts.day_of_week ASC, ts.period ASC, ts.id ASC
      `,
      [linkId],
    );
    return result.rows;
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
        WHEN tl.opens_at IS NOT NULL AND tl.opens_at > NOW() THEN 'SCHEDULED'
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
        COUNT(*) FILTER (WHERE link_state = 'EXPIRED')::int AS expired,
        COUNT(*) FILTER (WHERE link_state = 'SCHEDULED')::int AS scheduled
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
        tl.token_encrypted,
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
      rows: result.rows.map(({ token_encrypted, ...row }) => ({
        ...row,
        magic_link: this.resolveMagicLink(token_encrypted as string | null),
      })),
      totalCount,
      summary: {
        total: Number(summaryRow.total || 0),
        active: Number(summaryRow.active || 0),
        locked: Number(summaryRow.locked || 0),
        expired: Number(summaryRow.expired || 0),
        scheduled: Number(summaryRow.scheduled || 0),
      },
    };
  }

  async listVisitLinksPaginated(
    actor: ActorContext | undefined,
    filters: VisitLinkListFilters = {},
  ): Promise<{ rows: QueryResultRow[]; totalCount: number; summary: VisitLinkSummary }> {
    const params: unknown[] = [];
    const baseConditions: string[] = [
      `t.task_type = 'VISIT'`,
      `tl.deleted_at IS NULL`,
      `tl.status = 'ACTIVE'`,
      `t.deleted_at IS NULL`,
      `c.deleted_at IS NULL`,
    ];
    const linkStateSql = `
      CASE
        WHEN tl.expires_at <= NOW() THEN 'EXPIRED'
        WHEN tl.admin_locked = 1 THEN 'LOCKED'
        WHEN tl.opens_at IS NOT NULL AND tl.opens_at > NOW() THEN 'SCHEDULED'
        ELSE 'ACTIVE'
      END
    `;

    const scopeQuery = this.buildCaseScopeQuery(actor, params.length + 1, 'c');
    if (scopeQuery.sql) {
      baseConditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      const searchPlaceholder = params.length;
      baseConditions.push(`
        (
          c.student_name ILIKE $${searchPlaceholder}
          OR c.student_first_name ILIKE $${searchPlaceholder}
          OR c.student_last_name ILIKE $${searchPlaceholder}
          OR c.student_school ILIKE $${searchPlaceholder}
          OR tl.assigned_to_name ILIKE $${searchPlaceholder}
          OR tl.assigned_to_email ILIKE $${searchPlaceholder}
        )
      `);
    }

    if (filters.province) {
      params.push(filters.province);
      baseConditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.province = $${params.length})`,
      );
    }
    if (filters.district) {
      params.push(filters.district);
      baseConditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.district = $${params.length})`,
      );
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      baseConditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.sub_district = $${params.length})`,
      );
    }
    if (filters.schoolId) {
      params.push(filters.schoolId);
      baseConditions.push(`c.school_id = $${params.length}`);
    }
    if (filters.gradeLevelId) {
      params.push(filters.gradeLevelId);
      baseConditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_student
          WHERE case_student.student_uuid = c.student_uuid
            AND case_student."GradeLevelID_Onec" = $${params.length}
        )
      `);
    }
    if (filters.room) {
      params.push(filters.room);
      baseConditions.push(`
        EXISTS (
          SELECT 1
          FROM student_term case_student
          WHERE case_student.student_uuid = c.student_uuid
            AND case_student."RoomID_Onec"::text = $${params.length}
        )
      `);
    }

    const filteredConditions = [...baseConditions];
    if (filters.status && filters.status !== 'ALL') {
      params.push(filters.status);
      filteredConditions.push(`${linkStateSql} = $${params.length}`);
    }

    const baseParamCount = params.length - (filteredConditions.length - baseConditions.length);
    const fromSql = `
      FROM tasks t
      JOIN cases c ON c.id = t.case_id
      JOIN LATERAL (
        SELECT latest_link.*
        FROM task_links latest_link
        WHERE latest_link.task_id = t.id
          AND latest_link.status = 'ACTIVE'
          AND latest_link.deleted_at IS NULL
        ORDER BY latest_link.delegation_depth DESC, latest_link.created_at DESC
        LIMIT 1
      ) tl ON true
      LEFT JOIN schools school ON school.id = c.school_id
      LEFT JOIN student_term student ON student.student_uuid = c.student_uuid
      LEFT JOIN grade_levels grade ON grade.id = student."GradeLevelID_Onec"
    `;
    const baseWhereSql = `WHERE ${baseConditions.join(' AND ')}`;
    const filteredWhereSql = `WHERE ${filteredConditions.join(' AND ')}`;

    const summaryResult = await this.query<QueryResultRow>(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE link_state = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE link_state = 'LOCKED')::int AS locked,
        COUNT(*) FILTER (WHERE link_state = 'EXPIRED')::int AS expired,
        COUNT(*) FILTER (WHERE link_state = 'SCHEDULED')::int AS scheduled
      FROM (
        SELECT ${linkStateSql} AS link_state
        ${fromSql}
        ${baseWhereSql}
      ) scoped_visit_links
    `,
      params.slice(0, baseParamCount),
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
        t.case_id,
        t.task_type,
        tl.assigned_to_name,
        tl.assigned_to_email,
        tl.expires_at,
        tl.opens_at,
        tl.status,
        tl.token_encrypted,
        tl.admin_locked,
        tl.admin_lock_reason,
        tl.admin_lock_at,
        tl.delegation_depth,
        tl.created_at,
        c.student_name,
        c.student_first_name,
        c.student_last_name,
        c.student_school,
        c.status AS case_status,
        c.reason_flagged,
        c.school_id,
        school.name AS school_name,
        student.student_uuid AS student_id,
        grade.id AS grade_level_id,
        grade.label AS grade_label,
        student."RoomID_Onec" AS room,
        ${linkStateSql} AS link_state
      ${fromSql}
      ${filteredWhereSql}
      ORDER BY tl.created_at DESC, tl.id DESC
      LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
    `,
      selectParams,
    );

    const summaryRow = summaryResult.rows[0] || {};
    return {
      rows: result.rows.map(({ token_encrypted, ...row }) => ({
        ...row,
        magic_link: this.resolveMagicLink(token_encrypted as string | null),
      })),
      totalCount,
      summary: {
        total: Number(summaryRow.total || 0),
        active: Number(summaryRow.active || 0),
        locked: Number(summaryRow.locked || 0),
        expired: Number(summaryRow.expired || 0),
        scheduled: Number(summaryRow.scheduled || 0),
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
    linkId?: string | null,
  ): Promise<QueryResultRow[]> {
    const params: unknown[] = [
      date,
      targetGrade,
      Number.parseInt(targetRoom || '0', 10),
      targetSchoolId,
    ];
    const linkModeSql =
      typeof linkId === 'string' && linkId.trim().length > 0
        ? `
        AND (
          (
            NOT EXISTS (
              SELECT 1 FROM task_link_timetable_slots link_slot
              WHERE link_slot.task_link_id = $5
            )
            AND a."Period" = 1
            AND a.session_kind = 'DAILY'
          )
          OR (
            a.session_kind = 'SUBJECT'
            AND EXISTS (
              SELECT 1 FROM task_link_timetable_slots link_slot
              WHERE link_slot.task_link_id = $5
                AND link_slot.timetable_slot_id = sess.timetable_slot_id
            )
          )
        )
      `
        : `
        AND a."Period" = 1
        AND a.session_kind = 'DAILY'
      `;
    if (typeof linkId === 'string' && linkId.trim().length > 0) {
      params.push(linkId.trim());
    }
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        a.student_uuid AS student_id,
        (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
        a."AttendanceStatus" AS status,
        a.session_kind,
        a."Period" AS period,
        sess.timetable_slot_id,
        sub.name_th AS subject_name_th,
        sub.code AS subject_code
      FROM attendance a
      JOIN student_term s ON s.student_uuid = a.student_uuid
      LEFT JOIN attendance_sessions sess ON sess.id = a.session_id
      LEFT JOIN subjects sub ON sub.id = sess.subject_id
      WHERE a."AttendanceDate" = $1
        AND s."GradeLevelID_Onec" = (SELECT id FROM grade_levels WHERE label = $2)
        AND s."RoomID_Onec" = $3
        AND s."SchoolID_Onec" = $4
        ${linkModeSql}
      ORDER BY a.student_uuid ASC, a."Period" ASC
    `,
      params,
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
        tl.token_encrypted,
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

    return result.rows.map(({ token_encrypted, ...row }) => ({
      ...row,
      magic_link: this.resolveMagicLink(token_encrypted as string | null),
    }));
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
         tl.opens_at,
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
        t.target_school_id,
        c.created_by AS case_created_by
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN cases c ON c.id = t.case_id
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
        tl.token_encrypted,
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
        s.name AS school_name,
        c.created_by AS case_created_by
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      LEFT JOIN roles r ON r.name = COALESCE(NULLIF(TRIM(tl.login_role), ''), 'TEACHER')
      LEFT JOIN cases c ON c.id = t.case_id
      WHERE tl.id = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [linkId],
    );

    const { token_encrypted, ...row } = result.rows[0] || {};
    return result.rows[0]
      ? { ...row, magic_link: this.resolveMagicLink(token_encrypted as string | null) }
      : null;
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
        case_status.label_th AS status_label,
        case_status.badge_variant AS status_badge_variant,
        case_status.summary_tone AS status_summary_tone,
        c.created_at,
        student_match.student_id,
        t.id AS task_id,
        tl.id AS active_link_id,
        tl.token_encrypted AS active_link_token_encrypted,
        tl.admin_locked AS active_link_locked,
        tl.admin_lock_reason AS active_link_lock_reason,
        tl.created_at AS active_link_created_at,
        tl.expires_at AS active_link_expires_at,
        tl.assigned_to_name AS active_link_assigned_to,
        tl.delegation_depth AS active_link_depth,
        COALESCE(link_state_snapshot.link_state, 'NONE') AS link_state
      FROM cases c
      INNER JOIN case_workflow_statuses case_status ON case_status.code = c.status
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
            WHEN latest_active_link.opens_at IS NOT NULL AND latest_active_link.opens_at > NOW() THEN 'SCHEDULED'
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

    return {
      rows: result.rows.map(({ active_link_token_encrypted, ...row }) => ({
        ...row,
        active_link: this.resolveMagicLink(active_link_token_encrypted as string | null),
      })),
      totalCount,
      statusCounts,
    };
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

  async countActiveCases(actor?: ActorContext): Promise<number> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 1);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<CountRow>(
      `SELECT count(*) FROM cases c WHERE c.status <> 'RESOLVED' AND c.deleted_at IS NULL${scopeSql}`,
      scopeQuery.params,
    );

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countAtRiskStudents(actor?: ActorContext): Promise<number> {
    const activeStatuses = ['OPEN', 'IN_PROGRESS', 'REPORTED_UP', 'PENDING_REVIEW'];
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

  async listRiskDashboardStudents(
    actor: ActorContext,
    filters: RiskDashboardFilters,
    thresholds: RiskDashboardThresholds,
  ): Promise<RiskDashboardResult> {
    if (actor.data_scope?.own_only === true) {
      return { rows: [], totalCount: 0, summary: { ...EMPTY_RISK_DASHBOARD_SUMMARY } };
    }

    void thresholds;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (actor.data_scope) {
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

    if (filters.province) {
      params.push(filters.province);
      conditions.push(`sc.province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(`sc.district = $${params.length}`);
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(`sc.sub_district = $${params.length}`);
    }
    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
    }
    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`gl.label = $${params.length}`);
    }
    if (filters.room) {
      params.push(filters.room);
      conditions.push(`s."RoomID_Onec"::text = $${params.length}`);
    }
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(
        `((s."FirstName_Onec" || ' ' || s."LastName_Onec") ILIKE $${params.length} OR s."PersonID_Onec" ILIKE $${params.length})`,
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseCte = `
      WITH base_students AS (
        SELECT
          s.student_uuid,
          s."SchoolID_Onec" AS school_id,
          (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
          COALESCE(gl.label, 'ไม่ทราบ') AS grade,
          s."RoomID_Onec"::text AS room,
          sc.name AS school_name,
          COALESCE(profile.consecutive_absent_days, 0)::int AS consecutive_absent_days,
          COALESCE(profile.absent_days, 0)::int AS absent_days,
          COALESCE(profile.late_count, 0)::int AS late_count,
          COALESCE(profile.subject_late_count, 0)::int AS subject_late_count,
          COALESCE(profile.school_day_count, 0)::int AS school_day_count,
          COALESCE(profile.weighted_absence_days, 0)::numeric AS weighted_absence_days,
          profile.weighted_attendance_percent,
          COALESCE(profile.risk_tier, 'NORMAL') AS risk_tier,
          COALESCE(profile.risk_severity, 0)::int AS risk_severity,
          COALESCE(profile.risk_score, 0)::numeric AS risk_score,
          COALESCE(profile.open_case_count, 0)::int AS open_case_count,
          profile.latest_open_case_id,
          latest_case.reason_flagged AS latest_open_case_reason,
          profile.latest_open_task_id,
          latest_case.created_at AS latest_case_at,
          (profile.student_uuid IS NULL) AS missing_profile
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        LEFT JOIN cases latest_case
          ON latest_case.id = profile.latest_open_case_id
         AND latest_case.deleted_at IS NULL
        ${whereSql}
      )
    `;

    const filteredParams = [...params];
    const riskWhere =
      filters.riskTier && filters.riskTier !== 'NORMAL'
        ? (() => {
            filteredParams.push(filters.riskTier);
            return `WHERE risk_tier = $${filteredParams.length}`;
          })()
        : filters.riskTier === 'NORMAL'
          ? (() => {
              filteredParams.push('NORMAL');
              return `WHERE risk_tier = $${filteredParams.length}`;
            })()
          : '';
    const filteredCte = `${baseCte}, filtered AS (SELECT * FROM base_students ${riskWhere})`;

    const summaryResult = await this.query<RiskDashboardSummaryRow>(
      `
        ${baseCte}
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE risk_tier = 'HIGH')::int AS "HIGH",
          COUNT(*) FILTER (WHERE risk_tier = 'MEDIUM')::int AS "MEDIUM",
          COUNT(*) FILTER (WHERE risk_tier = 'LOW')::int AS "LOW",
          COUNT(*) FILTER (WHERE risk_tier = 'WATCH')::int AS "WATCH",
          COUNT(*) FILTER (WHERE risk_tier = 'NORMAL')::int AS "NORMAL",
          COUNT(*) FILTER (WHERE missing_profile)::int AS missing_profile_count
        FROM base_students
      `,
      params,
    );
    const totalCountResult = await this.query<CountRow>(
      `
        ${filteredCte}
        SELECT COUNT(*)::int AS count
        FROM filtered
      `,
      filteredParams,
    );

    const totalCount = Number.parseInt(String(totalCountResult.rows[0]?.count || '0'), 10);
    const summary: RiskDashboardSummary = {
      HIGH: Number.parseInt(String(summaryResult.rows[0]?.HIGH || '0'), 10),
      MEDIUM: Number.parseInt(String(summaryResult.rows[0]?.MEDIUM || '0'), 10),
      LOW: Number.parseInt(String(summaryResult.rows[0]?.LOW || '0'), 10),
      WATCH: Number.parseInt(String(summaryResult.rows[0]?.WATCH || '0'), 10),
      NORMAL: Number.parseInt(String(summaryResult.rows[0]?.NORMAL || '0'), 10),
    };
    const missingProfileCount = Number.parseInt(
      String(summaryResult.rows[0]?.missing_profile_count || '0'),
      10,
    );

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;
    const rowParams = [...filteredParams, limit, offset];
    const limitPlaceholder = rowParams.length - 1;
    const offsetPlaceholder = rowParams.length;

    const sortDirection = filters.sortDirection === 'asc' ? 'ASC' : 'DESC';
    const orderBy =
      filters.sortBy === 'name'
        ? `student_name ${sortDirection}, school_name ASC NULLS LAST, grade ASC, room ASC`
        : filters.sortBy === 'school'
          ? `school_name ${sortDirection} NULLS LAST, grade ASC, room ASC, student_name ASC`
          : filters.sortBy === 'grade'
            ? `grade ${sortDirection}, room ASC, student_name ASC`
            : filters.sortBy === 'room'
              ? `room ${sortDirection}, grade ASC, student_name ASC`
              : filters.sortBy === 'attendance'
                ? `weighted_attendance_percent ${sortDirection} NULLS LAST, risk_severity DESC, student_name ASC`
                : filters.sortBy === 'openCases'
                  ? `open_case_count ${sortDirection}, risk_severity DESC, risk_score DESC, student_name ASC`
                  : `risk_severity ${sortDirection}, risk_score ${sortDirection}, student_name ASC`;

    const rowsResult = await this.query<RiskDashboardRow>(
      `
        ${filteredCte}
        SELECT
          student_uuid,
          student_name,
          school_id,
          school_name,
          grade,
          room,
          consecutive_absent_days,
          absent_days,
          late_count,
          subject_late_count,
          school_day_count,
          ROUND(weighted_absence_days, 2) AS weighted_absence_days,
          weighted_attendance_percent,
          risk_tier,
          ROUND(risk_score, 4) AS risk_score,
          open_case_count,
          latest_open_case_id,
          latest_open_case_reason,
          latest_open_task_id,
          latest_case_at
        FROM filtered
        ORDER BY ${orderBy}
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      rowParams,
    );

    return { rows: rowsResult.rows, totalCount, summary, missingProfileCount };
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

  async listCaseReportUps(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        report_up.id,
        report_up.case_id,
        report_up.school_id,
        report_up.reported_by,
        report_up.reported_by_label,
        report_up.report_reason,
        report_up.report_summary,
        report_up.school_name_snapshot,
        report_up.province_snapshot,
        report_up.district_snapshot,
        report_up.sub_district_snapshot,
        report_up.reported_at
      FROM case_report_ups report_up
      WHERE report_up.case_id = $1
      ORDER BY report_up.reported_at DESC
    `,
      [caseId],
    );

    return result.rows;
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
