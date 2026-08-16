import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { appConfig } from '../config/app.config';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import { isUnconfiguredDataScope, normalizeScopeArray } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern, normalizeScalar } from '../common/utils/helpers';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import type {
  ActorContext,
  DataScope,
  QueryExecutor,
  QueryResultLike,
  QueryResultRow,
  RiskDashboardCaseStatusSummary,
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

/**
 * Observed residence-environment factors of one submission, already ordered and
 * labelled. Correlated on `submission.id`, so every query that embeds it must
 * expose the submission row under that alias.
 */
const RESIDENCE_ENVIRONMENTS_JSON_SQL = `COALESCE((
          SELECT json_agg(
                   json_build_object('code', option.code, 'label', option.label_th)
                   ORDER BY option.sort_order, option.code
                 )
          FROM task_submission_residence_environments link
          JOIN residence_environment_options option
            ON option.code = link.residence_environment_code
          WHERE link.task_submission_id = submission.id
        ), '[]'::json)`;

const EMPTY_RISK_DASHBOARD_SUMMARY: RiskDashboardSummary = {
  HIGH: 0,
  WATCH: 0,
  NORMAL: 0,
};

const EMPTY_RISK_DASHBOARD_CASE_STATUS_SUMMARY: RiskDashboardCaseStatusSummary = {
  OPEN: 0,
  IN_PROGRESS: 0,
  PENDING_REVIEW: 0,
  STUDENT_NOT_FOUND: 0,
};

interface RiskDashboardSummaryRow extends QueryResultRow, RiskDashboardSummary {
  total_count: number | string;
  missing_profile_count?: number | string;
  case_open_count?: number | string;
  case_in_progress_count?: number | string;
  case_pending_review_count?: number | string;
  case_student_not_found_count?: number | string;
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
  /** Chosen when an assistance round is assigned; empty for follow-up visits. */
  assistanceMeasureCodes?: string[];
  assistanceMeasureDetail?: string | null;
}

interface CreateTaskLinkInput {
  linkId: string;
  taskId: string;
  tokenHash: string;
  /** AES-256-GCM ciphertext of the raw token (see TokenEncryptionService). */
  tokenEncrypted: string;
  assignedToName: string;
  assignedToFirstName: string | null;
  assignedToLastName: string | null;
  assignedToPhone: string | null;
  assignedToEmail: string | null;
  /**
   * The teacher this link was issued to. AraID verification compares the
   * verified citizen id against this user, so it must be the authoritative
   * reference — not the denormalised name/email beside it.
   */
  assignedTeacherUserId: number | null;
  expiresAt: string;
  /** Optional future open time; null = usable immediately. */
  opensAt: string | null;
  subject: string | null;
  assignmentNote: string | null;
  subjectId: number | null;
  otpVerified: number;
  createdBy: number | null;
  loginRole: string | null;
  loginPermissions: string[];
  loginDataScope: DataScope | Record<string, unknown>;
}

export interface VisitAssigneeRow extends QueryResultRow {
  teacher_user_id: number | string;
  display_name: string;
  email: string | null;
  is_homeroom: boolean;
}

interface TaskSubmissionInput {
  linkId: string;
  visitLat: number | null;
  visitLng: number | null;
  visitedAt: string | null;
  causeCategory: string | null;
  followUpAssessmentCode: string | null;
  parentalStatusCode: string | null;
  guardianTypeCode: string | null;
  guardianTypeDetail: string | null;
  residenceEnvironmentCodes: string[];
  residenceEnvironmentDetail: string | null;
  causeDetail: string | null;
  recommendation: string | null;
  photoPaths: string | null;
  addressChanged: boolean;
  homeVisitExceptionCode: string | null;
  updatedStudentAddress: string | null;
  updatedAddressLine: string | null;
  updatedAddressProvince: string | null;
  updatedAddressDistrict: string | null;
  updatedAddressSubDistrict: string | null;
  updatedPostalCode: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
  caseFollowUpDecision: string | null;
  caseResolutionOutcomeCode: string | null;
  /** Assistance rounds only (task_type = 'ASSIST'). */
  assistedAt: string | null;
  assistanceDetail: string | null;
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
  nextStatus: string;
  completionOutcomeCode?: string | null;
  nextSummary: string;
  updatedStudentAddress: string | null;
  updatedAddressLine: string | null;
  updatedAddressProvince: string | null;
  updatedAddressDistrict: string | null;
  updatedAddressSubDistrict: string | null;
  updatedPostalCode: string | null;
  updatedLat: number | null;
  updatedLng: number | null;
  clearMissingCoordinates: boolean;
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
  reviewSummary: string | null;
  resolutionOutcome: string | null;
  reviewedBy: string;
  sourceActorUserId: number | null;
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
  private readonly logger = new Logger(TaskRepository.name);

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
    try {
      const token = this.tokenEncryption.decrypt(tokenEncrypted);
      return `${this.appRuntimeConfig.frontendBaseUrl ?? ''}/task/${token}`;
    } catch {
      this.logger.warn('Unable to decrypt a stored task link; returning it as unavailable');
      return null;
    }
  }

  private async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private normalizeScopeIntArray(value: unknown): number[] {
    return normalizeScopeArray(value)
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
    const provinces = normalizeScopeArray(scope.provinces);
    if (provinces.length > 0) {
      schoolConditions.push(`case_scope_school.province = ANY($${paramIndex++}::text[])`);
      params.push(provinces);
    }

    const districts = normalizeScopeArray(scope.districts);
    if (districts.length > 0) {
      schoolConditions.push(`case_scope_school.district = ANY($${paramIndex++}::text[])`);
      params.push(districts);
    }

    const subDistricts = normalizeScopeArray(scope.sub_districts);
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
      const actorValues = normalizeScopeArray(scope[key]);
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
      name: normalizeScalar(row.name),
      label: normalizeScalar(row.label),
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
            AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
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
            AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
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
      SELECT id, school_id, student_uuid::text, student_name, status, workflow_phase_code
      FROM cases c
      WHERE c.id = $1 AND c.deleted_at IS NULL${scopeSql}
      LIMIT 1
    `,
      [caseId, ...scopeQuery.params],
    );
    return result.rows[0] || null;
  }

  async lockCaseForVisitAssignment(
    caseId: number,
    actor: ActorContext,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await executor.query<QueryResultRow>(
      `
      SELECT
        c.id,
        c.school_id,
        c.student_uuid::text,
        c.status,
        c.workflow_phase_code,
        EXISTS (
          SELECT 1
          FROM tasks active_task
          JOIN task_links active_link
            ON active_link.task_id = active_task.id
           AND active_link.deleted_at IS NULL
          WHERE active_task.case_id = c.id
            AND active_task.task_type IN ('VISIT', 'ASSIST')
            AND active_task.deleted_at IS NULL
            AND active_link.status = 'ACTIVE'
            AND active_link.expires_at > NOW()
        ) AS has_live_assignment
      FROM cases c
      WHERE c.id = $1
        AND c.deleted_at IS NULL${scopeSql}
      FOR UPDATE OF c
      `,
      [caseId, ...scopeQuery.params],
    );
    return result.rows[0] || null;
  }

  async listVisitAssignees(
    studentUuid: string,
    executor?: QueryExecutor,
  ): Promise<VisitAssigneeRow[]> {
    const result = await this.getExecutor(executor).query<VisitAssigneeRow>(
      `
        WITH current_student AS (
          SELECT student."SchoolID_Onec" AS school_id, student.classroom_id
          FROM student_term student
          JOIN student_current_enrollment_resolution enrollment
            ON enrollment.person_uuid = student.person_uuid
           AND enrollment.selected_student_uuid = student.student_uuid
           AND enrollment.resolution_state = 'ACTIVE'
          WHERE student.student_uuid = $1
          LIMIT 1
        )
        SELECT
          membership.teacher_user_id,
          COALESCE(
            NULLIF(TRIM(teacher_person.first_name || ' ' || teacher_person.last_name), ''),
            teacher.username
          ) AS display_name,
          teacher.email,
          EXISTS (
            SELECT 1
            FROM classroom_teacher_assignments assignment
            WHERE assignment.classroom_id = current_student.classroom_id
              AND assignment.teacher_membership_id = membership.id
              AND assignment.assignment_kind = 'HOMEROOM'
              AND assignment.assignment_status = 'ACTIVE'
              AND assignment.deleted_at IS NULL
          ) AS is_homeroom
        FROM current_student
        JOIN school_teacher_memberships membership
          ON membership.school_id = current_student.school_id
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
        JOIN teachers teacher_person
          ON teacher_person.id = membership.teacher_id
         AND teacher_person.teacher_status = 'ACTIVE'
         AND teacher_person.deleted_at IS NULL
        JOIN users teacher
          ON teacher.id = membership.teacher_user_id
         AND teacher.status = 'ACTIVE'
        ORDER BY
          is_homeroom DESC,
          COALESCE(
            NULLIF(TRIM(teacher_person.first_name || ' ' || teacher_person.last_name), ''),
            teacher.username
          ) COLLATE "th-x-icu",
          membership.id
      `,
      [studentUuid],
    );
    return result.rows;
  }

  async canAccessVisitAttachment(storagePath: string, actor: ActorContext): Promise<boolean> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<{ allowed: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM task_submissions submission
          JOIN task_links link ON link.id = submission.task_link_id
          JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
          JOIN cases c ON c.id = task.case_id AND c.deleted_at IS NULL
          WHERE submission.photo_paths::jsonb @> jsonb_build_array($1::text)${scopeSql}
        ) AS allowed
      `,
      [storagePath, ...scopeQuery.params],
    );
    return result.rows[0]?.allowed === true;
  }

  async findCaseDetailById(caseId: number, actor?: ActorContext): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        c.id,
        c.student_uuid::text AS student_id,
        c.student_name,
        c.student_school,
        c.student_address,
        c.student_lat,
        c.student_lng,
        c.reason_flagged,
        c.status,
        case_status.label_th AS status_label,
        c.completion_outcome_code,
        completion_outcome.label_th AS completion_outcome_label,
        c.workflow_phase_code,
        CASE
          WHEN c.status = 'RESOLVED' AND completion_outcome.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', completion_outcome.label_th)
          WHEN c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
            AND case_phase.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', case_phase.label_th)
          ELSE case_status.label_th
        END AS display_status_label,
        case_status.badge_variant AS status_badge_variant,
        c.created_at,
        c.updated_at,
        c.school_id,
        grade.label AS grade,
        student."RoomID_Onec"::text AS room,
        person.photo_storage_key AS student_photo_storage_key,
        person.updated_at AS student_photo_updated_at,
        person_contact.phone AS student_phone,
        COALESCE(
          latest_comment.comment_text,
          c.reason_flagged
        ) AS teacher_comment,
        latest_task.id AS task_id
      FROM cases c
      INNER JOIN case_workflow_statuses case_status ON case_status.code = c.status
      LEFT JOIN case_completion_outcomes completion_outcome
        ON completion_outcome.code = c.completion_outcome_code
      LEFT JOIN case_workflow_phases case_phase
        ON case_phase.code = c.workflow_phase_code
      LEFT JOIN student_term student ON student.student_uuid = c.student_uuid
      LEFT JOIN student_person person ON person.person_uuid = student.person_uuid
      LEFT JOIN student_person_contact person_contact ON person_contact.person_uuid = student.person_uuid
      LEFT JOIN grade_levels grade ON grade.id = student."GradeLevelID_Onec"
      LEFT JOIN LATERAL (
        SELECT comment.comment_text
        FROM classroom_student_comments comment
        WHERE comment.classroom_id = student.classroom_id
          AND comment.person_uuid = student.person_uuid
        ORDER BY comment.created_at DESC, comment.id DESC
        LIMIT 1
      ) latest_comment ON TRUE
      LEFT JOIN LATERAL (
        SELECT task.id
        FROM tasks task
        WHERE task.case_id = c.id AND task.deleted_at IS NULL
        ORDER BY task.created_at DESC, task.id DESC
        LIMIT 1
      ) latest_task ON true
      WHERE c.id = $1 AND c.deleted_at IS NULL${scopeSql}
      LIMIT 1
      `,
      [caseId, ...scopeQuery.params],
    );
    return result.rows[0] || null;
  }

  async findStudentForCaseCreation(
    studentUuid: string,
    actor: ActorContext,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const params: unknown[] = [studentUuid];
    const scopeQuery = buildDataScopeQuery(
      actor.data_scope || {},
      {
        school_id: 'student."SchoolID_Onec"',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'student."GradeLevelID_Onec"',
        room: 'student."RoomID_Onec"::text',
      },
      params.length + 1,
    );
    const scopeSql = scopeQuery.sql ? ` AND (${scopeQuery.sql})` : '';
    params.push(...scopeQuery.params);

    const result = await executor.query<QueryResultRow>(
      `
      SELECT
        student.*,
        student.student_uuid::text,
        student."SchoolID_Onec" AS school_id,
        school.name AS school_name
      FROM student_term student
      LEFT JOIN schools school ON school.id = student."SchoolID_Onec"
      WHERE student.student_uuid = $1
        AND student.deleted_at IS NULL${scopeSql}
      FOR UPDATE OF student
      `,
      params,
    );
    return result.rows[0] || null;
  }

  async findActiveCaseByStudentUuid(
    studentUuid: string,
    actor: ActorContext,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await executor.query<QueryResultRow>(
      `
      SELECT c.id
      FROM cases c
      WHERE c.student_uuid = $1
        AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
        AND c.deleted_at IS NULL${scopeSql}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 1
      `,
      [studentUuid, ...scopeQuery.params],
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
      `UPDATE cases c
       SET status = $1,
           completion_outcome_code = CASE
             WHEN $1 = 'RESOLVED' THEN COALESCE(c.completion_outcome_code, 'CLOSED')
             ELSE NULL
           END
       WHERE c.id = $2 AND c.deleted_at IS NULL${scopeSql}`,
      [status, caseId, ...scopeQuery.params],
    );
  }

  /**
   * `nextPhaseCode` null keeps the case in the phase it is already in — only
   * `ASSIST` moves a case across phases, so closing or referring an assistance
   * case keeps `ASSISTANCE` on the record for history.
   */
  async transitionPendingReviewCase(
    caseId: number,
    nextStatus: string,
    completionOutcomeCode: string | null,
    executor: QueryExecutor,
    actor?: ActorContext,
    nextPhaseCode?: string | null,
  ): Promise<boolean> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 5);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await executor.query(
      `
        UPDATE cases c
        SET status = $1,
            completion_outcome_code = $2,
            workflow_phase_code = COALESCE($3, c.workflow_phase_code)
        WHERE c.id = $4
          AND c.status = 'PENDING_REVIEW'
          AND c.deleted_at IS NULL${scopeSql}
        RETURNING c.id
      `,
      [nextStatus, completionOutcomeCode, nextPhaseCode ?? null, caseId, ...scopeQuery.params],
    );
    return result.rows.length === 1;
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
        assistance_measure_detail,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', $6, $7, $8, $8)
    `,
      [
        data.taskId,
        data.caseId,
        data.taskType,
        data.targetGrade,
        data.targetRoom,
        data.targetSchoolId,
        data.assistanceMeasureDetail ?? null,
        data.createdBy,
      ],
    );
    const measureCodes = Array.from(new Set(data.assistanceMeasureCodes ?? [])).filter(
      (code) => code.length > 0,
    );
    if (measureCodes.length > 0) {
      await this.getExecutor(executor).query(
        `
        INSERT INTO task_assistance_measures (task_id, assistance_measure_code, created_by)
        SELECT $1, code, $3 FROM unnest($2::text[]) AS code
      `,
        [data.taskId, measureCodes, data.createdBy],
      );
    }
  }

  async createTaskLink(data: CreateTaskLinkInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_links (
        id,
        task_id,
        token_hash,
        token_encrypted,
        assigned_to_name,
        assigned_to_first_name,
        assigned_to_last_name,
        assigned_to_phone,
        assigned_to_email,
        assigned_teacher_user_id,
        expires_at,
        subject,
        assignment_note,
        subject_id,
        otp_verified,
        created_by,
        updated_by,
        login_role,
        login_permissions,
        login_data_scope,
        opens_at
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
        $15,
        $16,
        $16,
        $17,
        $18,
        $19,
        $20
      )
    `,
      [
        data.linkId,
        data.taskId,
        data.tokenHash,
        data.tokenEncrypted,
        data.assignedToName,
        data.assignedToFirstName,
        data.assignedToLastName,
        data.assignedToPhone,
        data.assignedToEmail,
        data.assignedTeacherUserId,
        data.expiresAt,
        data.subject,
        data.assignmentNote,
        data.subjectId,
        data.otpVerified,
        data.createdBy,
        data.loginRole,
        JSON.stringify(data.loginPermissions),
        JSON.stringify(data.loginDataScope),
        data.opensAt,
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
        COALESCE(
          NULLIF(TRIM(current_assignee_teacher.first_name || ' ' || current_assignee_teacher.last_name), ''),
          current_assignee_user.username,
          tl.assigned_to_name
        ) AS current_assignee_name,
        t.task_type,
        t.assistance_measure_detail,
        t.target_grade,
        t.target_room,
        t.target_school_id,
        t.status AS task_status,
        s.name AS school_name
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      LEFT JOIN users current_assignee_user
        ON current_assignee_user.id = tl.assigned_teacher_user_id
      LEFT JOIN teachers current_assignee_teacher
        ON current_assignee_teacher.linked_user_id = current_assignee_user.id
       AND current_assignee_teacher.deleted_at IS NULL
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
      SELECT
        c.id,
        c.student_name,
        c.student_school,
        c.student_address,
        c.address_line,
        c.address_province,
        c.address_district,
        c.address_sub_district,
        c.postal_code,
        c.student_lat,
        c.student_lng,
        c.reason_flagged,
        c.status,
        c.workflow_phase_code,
        CASE
          WHEN c.status = 'RESOLVED' AND completion_outcome.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', completion_outcome.label_th)
          WHEN c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
            AND case_phase.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', case_phase.label_th)
          ELSE case_status.label_th
        END AS display_status_label,
        person_contact.phone AS student_phone,
        enrollment."AcademicYear_Onec" AS academic_year,
        enrollment."Semester_Onec" AS semester,
        grade.label AS grade,
        enrollment."RoomID_Onec"::text AS room
      FROM cases c
      JOIN tasks t ON t.case_id = c.id
      LEFT JOIN case_workflow_statuses case_status ON case_status.code = c.status
      LEFT JOIN case_completion_outcomes completion_outcome
        ON completion_outcome.code = c.completion_outcome_code
      LEFT JOIN case_workflow_phases case_phase
        ON case_phase.code = c.workflow_phase_code
      LEFT JOIN student_person_contact person_contact
        ON person_contact.person_uuid = c.student_uuid
      LEFT JOIN LATERAL (
        SELECT current_enrollment.*
        FROM student_term current_enrollment
        WHERE current_enrollment.student_uuid = c.student_uuid
        ORDER BY
          current_enrollment."AcademicYear_Onec" DESC NULLS LAST,
          current_enrollment."Semester_Onec" DESC NULLS LAST
        LIMIT 1
      ) enrollment ON true
      LEFT JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
      WHERE t.id = $1 AND c.deleted_at IS NULL AND t.deleted_at IS NULL
      `,
      [taskId],
    );

    return result.rows[0] || null;
  }

  async listPublicCaseFollowUpHistory(caseId: number, limit = 5): Promise<QueryResultRow[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 5;
    const boundedLimit = Math.max(1, Math.min(normalizedLimit, 5));
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        link.assigned_to_name,
        submission.visited_at,
        submission.submitted_at,
        submission.cause_detail,
        link.opens_at AS assignment_starts_at,
        link.expires_at AS assignment_ends_at,
        link.assignment_note,
        assessment.label_th AS follow_up_assessment_label,
        exception.label_th AS exception_label
      FROM tasks task
      JOIN task_links link
        ON link.task_id = task.id
        AND link.deleted_at IS NULL
      JOIN task_submissions submission
        ON submission.task_link_id = link.id
        AND submission.deleted_at IS NULL
      LEFT JOIN follow_up_result_options assessment
        ON assessment.code = submission.follow_up_assessment_code
      LEFT JOIN home_visit_exception_options exception
        ON exception.code = submission.home_visit_exception_code
      WHERE task.case_id = $1
        AND task.task_type = 'VISIT'
        AND task.deleted_at IS NULL
      ORDER BY submission.submitted_at DESC, submission.id DESC
      LIMIT $2
      `,
      [caseId, boundedLimit],
    );
    return result.rows;
  }

  async listPublicCaseContactChannels(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        contact_kind,
        relation,
        relation_note,
        full_name,
        phone,
        is_primary
      FROM (
        SELECT
          0 AS sort_order,
          'STUDENT'::text AS contact_kind,
          'STUDENT'::text AS relation,
          NULL::text AS relation_note,
          c.student_name AS full_name,
          person_contact.phone,
          TRUE AS is_primary
        FROM cases c
        LEFT JOIN student_person_contact person_contact
          ON person_contact.person_uuid = c.student_uuid
        WHERE c.id = $1
          AND c.deleted_at IS NULL

        UNION ALL

        SELECT
          CASE WHEN guardian.is_primary THEN 1 ELSE 2 END AS sort_order,
          'GUARDIAN'::text AS contact_kind,
          guardian.relation::text,
          guardian.relation_note::text,
          guardian.full_name::text,
          guardian.phone::text,
          guardian.is_primary
        FROM cases c
        JOIN student_guardian guardian
          ON guardian.person_uuid = c.student_uuid
         AND guardian.deleted_at IS NULL
        WHERE c.id = $1
          AND c.deleted_at IS NULL
      ) contact
      WHERE NULLIF(btrim(phone), '') IS NOT NULL
      ORDER BY sort_order, full_name
      `,
      [caseId],
    );

    return result.rows;
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

  /**
   * Soft-delete the task and its links in one transaction so accountability
   * history survives for audit
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

  async findTaskChainTask(taskId: string, actor?: ActorContext): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        t.*,
        COALESCE(
          NULLIF(TRIM(t.target_grade), ''),
          case_grade.label
        ) AS resolved_target_grade,
        COALESCE(
          NULLIF(TRIM(t.target_room), ''),
          case_enrollment."RoomID_Onec"::text
        ) AS resolved_target_room,
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
        c.completion_outcome_code,
        c.workflow_phase_code,
        CASE
          WHEN c.status = 'RESOLVED' AND completion_outcome.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', completion_outcome.label_th)
          WHEN c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
            AND case_phase.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', case_phase.label_th)
          ELSE case_status.label_th
        END AS display_status_label,
        c.result_summary
      FROM tasks t
      LEFT JOIN cases c ON c.id = t.case_id AND c.deleted_at IS NULL
      LEFT JOIN case_workflow_statuses case_status ON case_status.code = c.status
      LEFT JOIN case_completion_outcomes completion_outcome
        ON completion_outcome.code = c.completion_outcome_code
      LEFT JOIN case_workflow_phases case_phase
        ON case_phase.code = c.workflow_phase_code
      LEFT JOIN student_term case_enrollment
        ON case_enrollment.student_uuid = c.student_uuid
      LEFT JOIN grade_levels case_grade
        ON case_grade.id = case_enrollment."GradeLevelID_Onec"
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
        tl.created_at
      FROM task_links tl
      WHERE tl.task_id = $1
        AND tl.deleted_at IS NULL
      ORDER BY tl.created_at ASC, tl.id ASC
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
        submission.cause_category,
        submission.follow_up_assessment_code,
        assessment.label_th AS follow_up_assessment_label,
        submission.parental_status_code,
        parental_status.label_th AS parental_status_label,
        submission.guardian_type_code,
        guardian_type.label_th AS guardian_type_label,
        submission.guardian_type_detail,
        submission.residence_environment_detail,
        ${RESIDENCE_ENVIRONMENTS_JSON_SQL} AS residence_environments,
        submission.cause_detail,
        submission.recommendation,
        submission.submitted_at,
        submission.visit_lat,
        submission.visit_lng,
        submission.photo_paths
      FROM task_submissions submission
      LEFT JOIN follow_up_result_options assessment
        ON assessment.code = submission.follow_up_assessment_code
        AND assessment.deleted_at IS NULL
      LEFT JOIN parental_status_options parental_status
        ON parental_status.code = submission.parental_status_code
        AND parental_status.deleted_at IS NULL
      LEFT JOIN guardian_type_options guardian_type
        ON guardian_type.code = submission.guardian_type_code
        AND guardian_type.deleted_at IS NULL
      WHERE submission.task_link_id = $1
        AND submission.deleted_at IS NULL
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
        tl.assigned_to_name,
        t.id AS task_id,
        t.case_id,
        t.task_type,
        c.student_name,
        c.school_id
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN cases c ON c.id = t.case_id AND c.deleted_at IS NULL
      WHERE tl.token_hash = $1
        AND tl.deleted_at IS NULL
        AND t.deleted_at IS NULL
    `,
      [tokenHash],
    );

    return result.rows[0] || null;
  }

  async insertTaskSubmission(data: TaskSubmissionInput, executor?: QueryExecutor): Promise<void> {
    const inserted = await this.getExecutor(executor).query<{ id: number } & QueryResultRow>(
      `
      INSERT INTO task_submissions (
        task_link_id,
        visit_lat,
        visit_lng,
        visited_at,
        cause_category,
        follow_up_assessment_code,
        parental_status_code,
        guardian_type_code,
        guardian_type_detail,
        residence_environment_detail,
        cause_detail,
        recommendation,
        photo_paths,
        address_changed,
        home_visit_exception_code,
        updated_student_address,
        updated_address_line,
        updated_address_province,
        updated_address_district,
        updated_address_sub_district,
        updated_postal_code,
        updated_lat,
        updated_lng,
        case_follow_up_decision,
        case_resolution_outcome_code,
        assisted_at,
        assistance_detail
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27
      )
      RETURNING id
    `,
      [
        data.linkId,
        data.visitLat,
        data.visitLng,
        data.visitedAt,
        data.causeCategory,
        data.followUpAssessmentCode,
        data.parentalStatusCode,
        data.guardianTypeCode,
        data.guardianTypeDetail,
        data.residenceEnvironmentDetail,
        data.causeDetail,
        data.recommendation,
        data.photoPaths,
        data.addressChanged,
        data.homeVisitExceptionCode,
        data.updatedStudentAddress,
        data.updatedAddressLine,
        data.updatedAddressProvince,
        data.updatedAddressDistrict,
        data.updatedAddressSubDistrict,
        data.updatedPostalCode,
        data.updatedLat,
        data.updatedLng,
        data.caseFollowUpDecision,
        data.caseResolutionOutcomeCode,
        data.assistedAt,
        data.assistanceDetail,
      ],
    );

    if (data.residenceEnvironmentCodes.length === 0) return;
    const submissionId = inserted.rows[0]?.id;
    if (submissionId == null) return;
    // One row per observed factor: a home can sit near a drug spot and carry a
    // violence risk at the same time, so the answer is a set, not a column.
    await this.getExecutor(executor).query(
      `
      INSERT INTO task_submission_residence_environments (
        task_submission_id,
        residence_environment_code
      )
      SELECT $1, code
      FROM unnest($2::varchar[]) AS code
    `,
      [submissionId, data.residenceEnvironmentCodes],
    );
  }

  async updateCaseAfterSubmission(
    data: CaseSubmissionUpdateInput,
    executor?: QueryExecutor,
  ): Promise<boolean> {
    // Address text and coordinates update independently: COALESCE keeps the
    // existing value when a field is null, so a pin-only correction (coords with
    // no typed address) still saves student_lat/lng without wiping the address.
    const result = await this.getExecutor(executor).query(
      `
        UPDATE cases
        SET
          status = $1,
          completion_outcome_code = $13,
          result_summary = $2,
          student_address = COALESCE($3, student_address),
          address_line = COALESCE($4, address_line),
          address_province = COALESCE($5, address_province),
          address_district = COALESCE($6, address_district),
          address_sub_district = COALESCE($7, address_sub_district),
          postal_code = COALESCE($8, postal_code),
          student_lat = CASE WHEN $11 THEN $9 ELSE COALESCE($9, student_lat) END,
          student_lng = CASE WHEN $11 THEN $10 ELSE COALESCE($10, student_lng) END
        WHERE id = $12
          AND status IN ('OPEN', 'IN_PROGRESS')
          AND deleted_at IS NULL
        RETURNING id
      `,
      [
        data.nextStatus,
        data.nextSummary,
        data.updatedStudentAddress,
        data.updatedAddressLine,
        data.updatedAddressProvince,
        data.updatedAddressDistrict,
        data.updatedAddressSubDistrict,
        data.updatedPostalCode,
        data.updatedLat,
        data.updatedLng,
        data.clearMissingCoordinates,
        data.caseId,
        data.completionOutcomeCode ?? null,
      ],
    );
    return (result.rowCount ?? result.rows.length) === 1;
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
    return normalizeScalar(value) || null;
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
        COALESCE(
          NULLIF(TRIM(t.target_grade), ''),
          link_grade.label
        ) AS target_grade,
        COALESCE(
          NULLIF(TRIM(t.target_room), ''),
          link_enrollment."RoomID_Onec"::text
        ) AS target_room,
        t.target_school_id,
        c.created_by AS case_created_by
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN cases c ON c.id = t.case_id
      LEFT JOIN student_term link_enrollment
        ON link_enrollment.student_uuid = c.student_uuid
      LEFT JOIN grade_levels link_grade
        ON link_grade.id = link_enrollment."GradeLevelID_Onec"
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
        COALESCE(
          NULLIF(TRIM(t.target_grade), ''),
          link_grade.label
        ) AS target_grade,
        COALESCE(
          NULLIF(TRIM(t.target_room), ''),
          link_enrollment."RoomID_Onec"::text
        ) AS target_room,
        t.target_school_id,
        s.name AS school_name,
        c.created_by AS case_created_by
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id
      LEFT JOIN schools s ON s.id = t.target_school_id
      LEFT JOIN roles r ON r.name = COALESCE(NULLIF(TRIM(tl.login_role), ''), 'TEACHER')
      LEFT JOIN cases c ON c.id = t.case_id
      LEFT JOIN student_term link_enrollment
        ON link_enrollment.student_uuid = c.student_uuid
      LEFT JOIN grade_levels link_grade
        ON link_grade.id = link_enrollment."GradeLevelID_Onec"
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
        `norm_full_name(case_student."FirstName_Onec", case_student."LastName_Onec") = LOWER(TRIM(c.student_name))`,
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
        c.completion_outcome_code,
        completion_outcome.label_th AS completion_outcome_label,
        c.workflow_phase_code,
        CASE
          WHEN c.status = 'RESOLVED' AND completion_outcome.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', completion_outcome.label_th)
          WHEN c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
            AND case_phase.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', case_phase.label_th)
          ELSE case_status.label_th
        END AS display_status_label,
        case_status.badge_variant AS status_badge_variant,
        c.created_at,
        student_match.student_id,
        student_match.photo_storage_key AS student_photo_storage_key,
        student_match.photo_updated_at AS student_photo_updated_at,
        t.id AS task_id,
        tl.id AS active_link_id,
        tl.token_encrypted AS active_link_token_encrypted,
        tl.admin_locked AS active_link_locked,
        tl.admin_lock_reason AS active_link_lock_reason,
        tl.created_at AS active_link_created_at,
        tl.expires_at AS active_link_expires_at,
        COALESCE(
          NULLIF(TRIM(active_assignee_teacher.first_name || ' ' || active_assignee_teacher.last_name), ''),
          active_assignee_user.username,
          tl.assigned_to_name
        ) AS active_link_assigned_to,
        latest_link.id AS latest_link_id,
        latest_link.status AS latest_link_status,
        CASE
          WHEN c.status <> 'RESOLVED' THEN COALESCE(
            NULLIF(TRIM(latest_assignee_teacher.first_name || ' ' || latest_assignee_teacher.last_name), ''),
            latest_assignee_user.username,
            latest_link.assigned_to_name
          )
          ELSE latest_link.assigned_to_name
        END AS latest_link_assigned_to,
        COALESCE(link_state_snapshot.link_state, 'NONE') AS link_state
      FROM cases c
      INNER JOIN case_workflow_statuses case_status ON case_status.code = c.status
      LEFT JOIN case_completion_outcomes completion_outcome
        ON completion_outcome.code = c.completion_outcome_code
      LEFT JOIN case_workflow_phases case_phase
        ON case_phase.code = c.workflow_phase_code
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) = 1 THEN (array_agg(candidate.student_uuid))[1]
            ELSE NULL
          END AS student_id,
          CASE
            WHEN COUNT(*) = 1 THEN (array_agg(candidate.photo_storage_key))[1]
            ELSE NULL
          END AS photo_storage_key,
          CASE
            WHEN COUNT(*) = 1 THEN (array_agg(candidate.photo_updated_at))[1]
            ELSE NULL
          END AS photo_updated_at
        FROM (
          SELECT DISTINCT s.student_uuid, person.photo_storage_key, person.updated_at AS photo_updated_at
          FROM student_term s
          LEFT JOIN student_person person ON person.person_uuid = s.person_uuid
          LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
          WHERE norm_full_name(s."FirstName_Onec", s."LastName_Onec") = LOWER(TRIM(c.student_name))
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
        ORDER BY latest_active_link.created_at DESC, latest_active_link.id DESC
        LIMIT 1
      ) link_state_snapshot ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM task_links
        WHERE task_id = t.id
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) tl ON true
      LEFT JOIN LATERAL (
        SELECT latest_assignee_link.*
        FROM task_links latest_assignee_link
        WHERE latest_assignee_link.task_id = t.id
          AND latest_assignee_link.deleted_at IS NULL
        ORDER BY latest_assignee_link.created_at DESC, latest_assignee_link.id DESC
        LIMIT 1
      ) latest_link ON true
      LEFT JOIN users active_assignee_user
        ON active_assignee_user.id = tl.assigned_teacher_user_id
      LEFT JOIN teachers active_assignee_teacher
        ON active_assignee_teacher.linked_user_id = active_assignee_user.id
       AND active_assignee_teacher.deleted_at IS NULL
      LEFT JOIN users latest_assignee_user
        ON latest_assignee_user.id = latest_link.assigned_teacher_user_id
      LEFT JOIN teachers latest_assignee_teacher
        ON latest_assignee_teacher.linked_user_id = latest_assignee_user.id
       AND latest_assignee_teacher.deleted_at IS NULL
      ${whereSql}
      ORDER BY c.created_at DESC, c.id DESC, t.id DESC NULLS LAST
      LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
    `,
      selectParams,
    );

    const statusCounts = await this.countCaseStatuses(actor, { ...filters, status: undefined });

    return {
      rows: result.rows.map(
        ({
          active_link_token_encrypted,
          student_photo_storage_key,
          student_photo_updated_at,
          ...row
        }) => {
          const studentId = typeof row.student_id === 'string' ? row.student_id : null;
          const photoStorageKey =
            typeof student_photo_storage_key === 'string' ? student_photo_storage_key : null;

          return {
            ...row,
            student_photo_url:
              studentId && photoStorageKey
                ? `/api/students/${encodeURIComponent(studentId)}/photo?v=${encodeMediaVersion(student_photo_updated_at)}`
                : null,
            active_link: this.resolveMagicLink(active_link_token_encrypted as string | null),
          };
        },
      ),
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
        `norm_full_name(case_student."FirstName_Onec", case_student."LastName_Onec") = LOWER(TRIM(c.student_name))`,
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
      `SELECT count(*) FROM cases c WHERE c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND') AND c.deleted_at IS NULL${scopeSql}`,
      scopeQuery.params,
    );

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countAtRiskStudents(actor?: ActorContext): Promise<number> {
    const activeStatuses = ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND'];
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
      return {
        rows: [],
        totalCount: 0,
        summary: { ...EMPTY_RISK_DASHBOARD_SUMMARY },
        caseStatusSummary: { ...EMPTY_RISK_DASHBOARD_CASE_STATUS_SUMMARY },
      };
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
    if (typeof filters.academicYear === 'number') {
      params.push(filters.academicYear);
      conditions.push(`s."AcademicYear_Onec" = $${params.length}`);
    }
    if (typeof filters.semester === 'number') {
      params.push(filters.semester);
      conditions.push(`s."Semester_Onec" = $${params.length}`);
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
      params.push(`%${escapeLikePattern(filters.searchTerm)}%`);
      conditions.push(
        `((s."FirstName_Onec" || ' ' || s."LastName_Onec") ILIKE $${params.length} ESCAPE '\\' OR s."PersonID_Onec" ILIKE $${params.length} ESCAPE '\\')`,
      );
    }

    // A risk row exists only once a case was opened. A watchlist row exists
    // only after a teacher left a comment for the student's current classroom.
    // Keep that product distinction in SQL before pagination and counting.
    const studentGroupConditions =
      filters.studentGroup === 'RISK'
        ? [...conditions, 'latest_case.id IS NOT NULL']
        : filters.studentGroup === 'WATCHLIST'
          ? [...conditions, 'latest_comment.id IS NOT NULL']
          : conditions;
    const whereSql =
      studentGroupConditions.length > 0 ? `WHERE ${studentGroupConditions.join(' AND ')}` : '';
    const baseCte = `
      WITH base_students AS (
        SELECT
          s.student_uuid,
          s."SchoolID_Onec" AS school_id,
          (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
          person.photo_storage_key,
          person.updated_at AS photo_updated_at,
          COALESCE(gl.label, 'ไม่ทราบ') AS grade,
          s."RoomID_Onec"::text AS room,
          sc.name AS school_name,
          COALESCE(profile.consecutive_absent_days, 0)::int AS consecutive_absent_days,
          COALESCE(profile.absent_days, 0)::int AS absent_days,
          COALESCE(profile.term_absent_days, 0)::int AS term_absent_days,
          profile.absence_reset_after_date,
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
          latest_case.id AS latest_case_id,
          latest_case.status AS latest_case_status,
          latest_case.updated_at AS latest_case_at,
          latest_case_link.token_encrypted AS latest_case_link_token_encrypted,
          latest_comment.id AS latest_comment_id,
          COALESCE(
            latest_comment.comment_text,
            CASE
              WHEN profile.absence_reset_after_date IS NULL
                THEN CONCAT('ขาดสะสมทั้งเทอม ', COALESCE(profile.term_absent_days, 0), ' วัน')
              ELSE CONCAT(
                'ขาดสะสมทั้งเทอม ', COALESCE(profile.term_absent_days, 0),
                ' วัน · หลังปิดเคสล่าสุด ', COALESCE(profile.absent_days, 0), ' วัน'
              )
            END
          ) AS teacher_comment,
          (profile.student_uuid IS NULL) AS missing_profile
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN student_person person ON person.person_uuid = s.person_uuid
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        LEFT JOIN LATERAL (
          SELECT c.id, c.status, c.updated_at, c.reason_flagged
          FROM cases c
          WHERE c.student_uuid = s.student_uuid
            AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 1
        ) latest_case ON TRUE
        LEFT JOIN LATERAL (
          SELECT link.token_encrypted
          FROM tasks task
          JOIN task_links link ON link.task_id = task.id
          WHERE task.case_id = latest_case.id
            AND task.deleted_at IS NULL
            AND link.deleted_at IS NULL
            AND link.status = 'ACTIVE'
            AND link.expires_at > NOW()
            AND COALESCE(link.admin_locked, 0) <> 1
            AND (link.opens_at IS NULL OR link.opens_at <= NOW())
          ORDER BY link.created_at DESC, link.id DESC
          LIMIT 1
        ) latest_case_link ON TRUE
        LEFT JOIN LATERAL (
          SELECT comment.id, comment.comment_text
          FROM classroom_student_comments comment
          WHERE comment.classroom_id = s.classroom_id
            AND comment.person_uuid = s.person_uuid
          ORDER BY comment.created_at DESC, comment.id DESC
          LIMIT 1
        ) latest_comment ON TRUE
        ${whereSql}
      )
    `;

    const scopedParams = [...params];
    const riskWhere =
      filters.riskTier && filters.riskTier !== 'NORMAL'
        ? (() => {
            scopedParams.push(filters.riskTier);
            return `WHERE risk_tier = $${scopedParams.length}`;
          })()
        : filters.riskTier === 'NORMAL'
          ? (() => {
              scopedParams.push('NORMAL');
              return `WHERE risk_tier = $${scopedParams.length}`;
            })()
          : '';
    const scopedCte = `${baseCte}, risk_scoped AS (SELECT * FROM base_students ${riskWhere})`;
    const filteredParams = [...scopedParams];
    const caseStatusWhere = filters.caseStatus
      ? (() => {
          filteredParams.push(filters.caseStatus);
          return `WHERE latest_case_status = $${filteredParams.length}`;
        })()
      : '';
    const filteredCte = `${scopedCte}, filtered AS (SELECT * FROM risk_scoped ${caseStatusWhere})`;

    const summaryResult = await this.query<RiskDashboardSummaryRow>(
      `
        ${scopedCte}
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE risk_tier = 'HIGH')::int AS "HIGH",
          COUNT(*) FILTER (WHERE risk_tier = 'WATCH')::int AS "WATCH",
          COUNT(*) FILTER (WHERE risk_tier = 'NORMAL')::int AS "NORMAL",
          COUNT(*) FILTER (WHERE missing_profile)::int AS missing_profile_count,
          COUNT(*) FILTER (WHERE latest_case_status = 'OPEN')::int AS case_open_count,
          COUNT(*) FILTER (WHERE latest_case_status = 'IN_PROGRESS')::int AS case_in_progress_count,
          COUNT(*) FILTER (WHERE latest_case_status = 'PENDING_REVIEW')::int AS case_pending_review_count,
          COUNT(*) FILTER (WHERE latest_case_status = 'STUDENT_NOT_FOUND')::int AS case_student_not_found_count
        FROM risk_scoped
      `,
      scopedParams,
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
      WATCH: Number.parseInt(String(summaryResult.rows[0]?.WATCH || '0'), 10),
      NORMAL: Number.parseInt(String(summaryResult.rows[0]?.NORMAL || '0'), 10),
    };
    const missingProfileCount = Number.parseInt(
      String(summaryResult.rows[0]?.missing_profile_count || '0'),
      10,
    );
    const caseStatusSummary: RiskDashboardCaseStatusSummary = {
      OPEN: Number.parseInt(String(summaryResult.rows[0]?.case_open_count || '0'), 10),
      IN_PROGRESS: Number.parseInt(
        String(summaryResult.rows[0]?.case_in_progress_count || '0'),
        10,
      ),
      PENDING_REVIEW: Number.parseInt(
        String(summaryResult.rows[0]?.case_pending_review_count || '0'),
        10,
      ),
      STUDENT_NOT_FOUND: Number.parseInt(
        String(summaryResult.rows[0]?.case_student_not_found_count || '0'),
        10,
      ),
    };

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
                  : filters.sortBy === 'updatedAt'
                    ? `latest_case_at ${sortDirection} NULLS LAST, student_name ASC`
                    : `risk_severity ${sortDirection}, risk_score ${sortDirection}, student_name ASC`;

    const rowsResult = await this.query<RiskDashboardRow>(
      `
        ${filteredCte}
        SELECT
          student_uuid,
          student_name,
          photo_storage_key,
          photo_updated_at,
          school_id,
          school_name,
          grade,
          room,
          consecutive_absent_days,
          absent_days,
          term_absent_days,
          absence_reset_after_date,
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
          latest_case_id,
          latest_case_status,
          latest_case_at,
          latest_case_link_token_encrypted,
          teacher_comment
        FROM filtered
        ORDER BY ${orderBy}
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      rowParams,
    );

    return {
      rows: rowsResult.rows.map(({ latest_case_link_token_encrypted, ...row }) => ({
        ...row,
        latest_case_magic_link: this.resolveMagicLink(
          latest_case_link_token_encrypted as string | null,
        ),
      })),
      totalCount,
      summary,
      caseStatusSummary,
      missingProfileCount,
    };
  }

  async insertCaseReview(data: CaseReviewInput, executor?: QueryExecutor): Promise<void> {
    await this.getExecutor(executor).query(
      `
      INSERT INTO case_reviews (
        id,
        case_id,
        review_action,
        review_note,
        review_summary,
        resolution_outcome,
        reviewed_by,
        source_actor_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        data.reviewId,
        data.caseId,
        data.reviewAction,
        data.reviewNote,
        data.reviewSummary,
        data.resolutionOutcome,
        data.reviewedBy,
        data.sourceActorUserId,
      ],
    );
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
        t.status AS task_status,
        t.task_type,
        t.assistance_measure_detail,
        (
          SELECT COALESCE(
            json_agg(
              json_build_object('code', measure.code, 'label', measure.label_th)
              ORDER BY measure.sort_order, measure.code
            ),
            '[]'::json
          )
          FROM task_assistance_measures link_measure
          JOIN assistance_measure_options measure ON measure.code = link_measure.assistance_measure_code
          WHERE link_measure.task_id = t.id
        ) AS assistance_measures,
        t.created_at,
        CASE
          WHEN tl.status = 'ACTIVE' THEN COALESCE(
            NULLIF(TRIM(current_assignee_teacher.first_name || ' ' || current_assignee_teacher.last_name), ''),
            current_assignee_user.username,
            tl.assigned_to_name
          )
          ELSE tl.assigned_to_name
        END AS initial_assignee,
        tl.opens_at AS assignment_starts_at,
        tl.expires_at AS assignment_ends_at,
        tl.assignment_note,
        (SELECT COUNT(*) FROM task_links WHERE task_id = t.id AND deleted_at IS NULL) AS link_count,
        latest_submission.submitted_at,
        latest_submission.visited_at,
        latest_submission.cause_category,
        latest_submission.follow_up_assessment_code,
        latest_submission.follow_up_assessment_label,
        latest_submission.parental_status_code,
        latest_submission.parental_status_label,
        latest_submission.guardian_type_code,
        latest_submission.guardian_type_label,
        latest_submission.guardian_type_detail,
        latest_submission.residence_environments,
        latest_submission.residence_environment_detail,
        latest_submission.cause_detail,
        latest_submission.recommendation,
        latest_submission.visit_lat,
        latest_submission.visit_lng,
        latest_submission.photo_paths,
        latest_submission.address_changed,
        latest_submission.home_visit_exception_code,
        latest_submission.updated_student_address,
        latest_submission.updated_address_line,
        latest_submission.updated_address_province,
        latest_submission.updated_address_district,
        latest_submission.updated_address_sub_district,
        latest_submission.updated_postal_code,
        latest_submission.updated_lat,
        latest_submission.updated_lng,
        latest_submission.case_follow_up_decision,
        latest_submission.case_resolution_outcome_code,
        latest_submission.assisted_at,
        latest_submission.assistance_detail
      FROM tasks t
      LEFT JOIN task_links tl ON tl.task_id = t.id AND tl.deleted_at IS NULL
      LEFT JOIN users current_assignee_user
        ON current_assignee_user.id = tl.assigned_teacher_user_id
      LEFT JOIN teachers current_assignee_teacher
        ON current_assignee_teacher.linked_user_id = current_assignee_user.id
       AND current_assignee_teacher.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT submission.submitted_at, submission.visited_at,
               submission.cause_category, submission.follow_up_assessment_code,
               assessment.label_th AS follow_up_assessment_label,
               submission.parental_status_code,
               parental_status.label_th AS parental_status_label,
               submission.guardian_type_code,
               guardian_type.label_th AS guardian_type_label,
               submission.guardian_type_detail,
               ${RESIDENCE_ENVIRONMENTS_JSON_SQL} AS residence_environments,
               submission.residence_environment_detail,
               submission.cause_detail,
               submission.recommendation, submission.visit_lat, submission.visit_lng,
               submission.photo_paths, submission.address_changed,
               submission.home_visit_exception_code,
               submission.updated_student_address, submission.updated_address_line,
               submission.updated_address_province, submission.updated_address_district,
               submission.updated_address_sub_district, submission.updated_postal_code,
               submission.updated_lat, submission.updated_lng,
               submission.case_follow_up_decision,
               submission.case_resolution_outcome_code,
               submission.assisted_at,
               submission.assistance_detail
        FROM task_links round_link
        JOIN task_submissions submission ON submission.task_link_id = round_link.id
        LEFT JOIN follow_up_result_options assessment
          ON assessment.code = submission.follow_up_assessment_code
          AND assessment.deleted_at IS NULL
        LEFT JOIN parental_status_options parental_status
          ON parental_status.code = submission.parental_status_code
          AND parental_status.deleted_at IS NULL
        LEFT JOIN guardian_type_options guardian_type
          ON guardian_type.code = submission.guardian_type_code
          AND guardian_type.deleted_at IS NULL
        WHERE round_link.task_id = t.id
          AND round_link.deleted_at IS NULL
          AND submission.deleted_at IS NULL
        ORDER BY submission.submitted_at DESC, submission.id DESC
        LIMIT 1
      ) latest_submission ON TRUE
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
      SELECT
        review.*,
        COALESCE(
          NULLIF(trim(concat_ws(' ', actor."FirstName", actor."LastName")), ''),
          actor.username,
          review.reviewed_by
        ) AS reviewer_display
      FROM case_reviews review
      LEFT JOIN users actor ON actor.id = review.source_actor_user_id
      WHERE review.case_id = $1
      ORDER BY review.reviewed_at DESC
    `,
      [caseId],
    );

    return result.rows;
  }

  async listCaseRiskSignals(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT id, signal_source_code, signal_rule_code, signal_reason, detected_at
      FROM case_risk_signals
      WHERE case_id = $1
      ORDER BY detected_at DESC, id DESC
    `,
      [caseId],
    );

    return result.rows;
  }

  /**
   * `available_phase_code` NULL means the action is offered in every phase, so
   * a phase filter keeps those and drops only the actions pinned elsewhere —
   * that is what limits the assistance review to ปิดเคส / ส่งต่อหน่วยงาน.
   */
  async listCaseReviewActions(phaseCode?: string | null): Promise<QueryResultRow[]> {
    const params = phaseCode ? [phaseCode] : [];
    const phaseSql = phaseCode
      ? 'AND (available_phase_code IS NULL OR available_phase_code = $1)'
      : '';
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, target_case_status_code, requires_resolution_outcome,
             required_permission_code, completion_outcome_code,
             available_phase_code, target_workflow_phase_code
      FROM case_review_actions
      WHERE is_active = TRUE AND deleted_at IS NULL ${phaseSql}
      ORDER BY sort_order, code
    `,
      params,
    );
    return result.rows;
  }

  /**
   * The identity AraID verification must match: the citizen id of the teacher
   * this link was issued to. Resolved through `assigned_teacher_user_id`, never
   * the denormalised email — `users.email` has no unique index.
   */
  async findTaskLinkAraIdIdentity(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        link.id AS link_id,
        link.assigned_teacher_user_id,
        link.assigned_to_name,
        teacher.citizen_id AS teacher_citizen_id
      FROM task_links link
      LEFT JOIN teachers teacher
        ON teacher.linked_user_id = link.assigned_teacher_user_id
       AND teacher.deleted_at IS NULL
      WHERE link.id = $1 AND link.deleted_at IS NULL
      LIMIT 1
    `,
      [linkId],
    );
    return result.rows[0] ?? null;
  }

  async listTaskAssistanceMeasures(
    taskId: string,
  ): Promise<Array<{ code: string; label: string }>> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT measure.code, measure.label_th
      FROM task_assistance_measures link_measure
      JOIN assistance_measure_options measure ON measure.code = link_measure.assistance_measure_code
      WHERE link_measure.task_id = $1
      ORDER BY measure.sort_order, measure.code
    `,
      [taskId],
    );
    return result.rows.map((row) => ({
      code: String(row.code),
      label: String(row.label_th),
    }));
  }

  async listAssistanceMeasures(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, requires_detail
      FROM assistance_measure_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findAssistanceMeasures(codes: string[]): Promise<QueryResultRow[]> {
    if (codes.length === 0) return [];
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, requires_detail
      FROM assistance_measure_options
      WHERE code = ANY($1::text[]) AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `,
      [codes],
    );
    return result.rows;
  }

  async listCaseFollowUpDecisions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, target_case_status_code, requires_resolution_outcome
      FROM case_follow_up_decisions
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async listCaseResolutionOutcomes(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th
      FROM case_resolution_outcomes
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async listHomeVisitExceptionOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, requires_updated_address
      FROM home_visit_exception_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async listHomeVisitAssessmentOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th
      FROM follow_up_result_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async listParentalStatusOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th
      FROM parental_status_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findParentalStatusOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th
      FROM parental_status_options
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async listGuardianTypeOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, requires_detail
      FROM guardian_type_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findGuardianTypeOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, requires_detail
      FROM guardian_type_options
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async listResidenceEnvironmentOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, is_exclusive, requires_detail
      FROM residence_environment_options
      WHERE is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findResidenceEnvironmentOptions(codes: string[]): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, is_exclusive, requires_detail
      FROM residence_environment_options
      WHERE code = ANY($1::varchar[]) AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY sort_order, code
    `,
      [codes],
    );
    return result.rows;
  }

  async findHomeVisitAssessmentOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th
      FROM follow_up_result_options
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findHomeVisitExceptionOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, requires_updated_address
      FROM home_visit_exception_options
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findCaseReviewAction(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, target_case_status_code, requires_resolution_outcome,
             required_permission_code, completion_outcome_code,
             available_phase_code, target_workflow_phase_code
      FROM case_review_actions
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findCaseFollowUpDecision(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, target_case_status_code, requires_resolution_outcome
      FROM case_follow_up_decisions
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findCaseResolutionOutcome(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th
      FROM case_resolution_outcomes
      WHERE code = $1 AND is_active = TRUE AND deleted_at IS NULL
      LIMIT 1
    `,
      [code],
    );
    return result.rows[0] ?? null;
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
