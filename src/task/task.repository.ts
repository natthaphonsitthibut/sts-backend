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
import { CASE_COMMENT_COMPLETION_BASELINE_SQL } from './case-comment-baseline.sql';
import type {
  ActorContext,
  DataScope,
  FollowUpAreaFilters,
  QueryExecutor,
  QueryResultLike,
  QueryResultRow,
  ReferralDrilldownFilters,
  RiskDashboardCaseStatusSummary,
  RiskDashboardConcernLevelSummary,
  RiskDashboardFilterOptions,
  RiskDashboardFilterOptionsFilters,
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

const EMPTY_RISK_DASHBOARD_CONCERN_LEVEL_SUMMARY: RiskDashboardConcernLevelSummary = {
  NOTE: 0,
  WATCH: 0,
  CONCERN: 0,
};

interface RiskDashboardSummaryRow extends QueryResultRow, RiskDashboardSummary {
  total_count: number | string;
  missing_profile_count?: number | string;
  case_open_count?: number | string;
  case_in_progress_count?: number | string;
  case_pending_review_count?: number | string;
  case_student_not_found_count?: number | string;
  concern_note_count?: number | string;
  concern_watch_count?: number | string;
  concern_count?: number | string;
}

/**
 * What a case-scope check actually reads: the data scope, plus the account id
 * only when that scope is `own_only`. Stated as its own type so a caller with a
 * scope but no account — a classroom link — can be checked the same way without
 * inventing a user to stand in for it. Every `ActorContext` satisfies it.
 */
export interface CaseScopeContext {
  id?: number;
  data_scope?: DataScope;
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
  /**
   * Set instead of `createdBy` when the case was opened from a classroom link:
   * that teacher has no account, so the `teachers` row is the only identity the
   * case can record.
   */
  createdByTeacherId?: string | null;
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
  /** Authoritative assignee reference used for task ownership and history. */
  assignedTeacherId: number | null;
  expiresAt: string;
  /** Optional future open time; null = usable immediately. */
  opensAt: string | null;
  subject: string | null;
  assignmentNote: string | null;
  subjectId: number | null;
  createdBy: number | null;
}

export interface VisitAssigneeRow extends QueryResultRow {
  teacher_id: string;
  display_name: string;
  email: string | null;
  is_homeroom: boolean;
}

interface TaskSubmissionInput {
  linkId: string;
  visitLat: number | null;
  visitLng: number | null;
  visitedAt: string | null;
  followUpProblemCategoryCode: string | null;
  absenceReasonCode: string | null;
  absenceReasonCategoryCode: string | null;
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
  taskExecutionOutcomeCode: string;
  executionOutcomeDetail: string | null;
  contactPersonName: string | null;
  contactChannelCode: string | null;
  nonFollowUpReasonCode: string | null;
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
  proposedAssistanceMeasureDetail: string | null;
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

/** The teacher's current verified LINE account, as the teacher-link page reads it. */
const ROUND_LINE_ACCOUNT_JOIN_SQL = `
  LEFT JOIN LATERAL (
    SELECT account.provider_user_id, account.friend_state
    FROM teacher_messaging_accounts account
    WHERE account.teacher_id = teacher.id
      AND account.provider = 'LINE'
      AND account.unlinked_at IS NULL
      AND account.deleted_at IS NULL
    ORDER BY account.verified_at DESC, account.id DESC
    LIMIT 1
  ) line_account ON TRUE
`;

export type RoundLineNotReadyCode =
  | 'ASSIGNEE_UNAVAILABLE'
  | 'MESSAGING_DISABLED'
  | 'ACCOUNT_NOT_VERIFIED'
  | 'ACCOUNT_NOT_REACHABLE';

export interface RoundLineLinkRow {
  id: string;
  task_id: string;
  status: string;
  expires_at: string | Date;
  assigned_teacher_id: string | null;
  task_type: string | null;
  student_name: string | null;
  student_school: string | null;
  line_provider_user_id: string | null;
  line_friend_state: string | null;
  magic_link: string | null;
  line_delivery_request_id: string | null;
  line_delivery_teacher_id: string | null;
  line_delivery_status: string;
  line_delivery_failure_code: string | null;
}

export type RoundLineClaimResult =
  | { kind: 'claimed' }
  | { kind: 'in_flight' }
  | { kind: 'completed'; status: 'SENT' | 'FAILED'; failure_code: string | null }
  | { kind: 'unavailable' };

/**
 * Where a referral stands in รอส่งต่อ → รอผล → พิจารณา → ผล, the way the
 * กลุ่มเสี่ยง tab reads a case (owner, 2026-10-08):
 *   - `AWAITING_REFERRAL` its case sits in รอส่งต่อ and nothing was sent yet
 *     (the register's case-only row, see `REFERRAL_REGISTER_SOURCE_SQL`)
 *   - `AWAITING_REFERRAL_OUTCOME` its case sits in รอผลการส่งต่อ, no result yet
 *   - `PENDING_REVIEW` the result is in and the case is back in รอพิจารณา
 *     because of it — the newest referral, nobody sent out on the case since
 *   - `RESOLVED` the reviewer has moved on from its result. Whether that
 *     result was สำเร็จ or ยังไม่สำเร็จ stays in `status_code`: the stage reads
 *     เสร็จสิ้น either way, as the step does on the case page (owner, 2026-10-11)
 *   - otherwise its own status (a cancelled referral)
 * Uses the `referral` and `c` aliases of the queries below.
 */
const REFERRAL_STAGE_SQL = `CASE
  WHEN referral.id IS NULL THEN 'AWAITING_REFERRAL'
  WHEN c.status = 'AWAITING_REFERRAL_OUTCOME'
    AND referral.status_code IN ('REFERRED', 'ACCEPTED')
    THEN 'AWAITING_REFERRAL_OUTCOME'
  WHEN c.status = 'PENDING_REVIEW'
    AND referral.status_code IN ('COMPLETED', 'NOT_SUCCEEDED')
    AND NOT EXISTS (
      SELECT 1 FROM case_referrals newer_referral
      WHERE newer_referral.case_id = referral.case_id
        AND (newer_referral.referred_at, newer_referral.id) > (referral.referred_at, referral.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM tasks later_task
      WHERE later_task.case_id = referral.case_id
        AND later_task.deleted_at IS NULL
        AND later_task.created_at > referral.referred_at
    )
    THEN 'PENDING_REVIEW'
  WHEN referral.status_code IN ('COMPLETED', 'NOT_SUCCEEDED') THEN 'RESOLVED'
  ELSE referral.status_code
END`;

/**
 * What งานส่งต่อ lists: every referral, plus one row for a case waiting in
 * รอส่งต่อ — chosen for referral, no agency picked yet — so the whole referral
 * flow reads on its own tab and none of it on กลุ่มเสี่ยง (owner, 2026-10-11).
 */
const REFERRAL_REGISTER_SOURCE_SQL = `(
  SELECT sent.id, sent.case_id, sent.status_code, sent.referred_at, sent.referral_agency_id
  FROM case_referrals sent
  UNION ALL
  SELECT NULL, pending_case.id, 'AWAITING_REFERRAL', pending_case.updated_at, NULL
  FROM cases pending_case
  WHERE pending_case.status = 'AWAITING_REFERRAL' AND pending_case.deleted_at IS NULL
) referral`;

/**
 * A case whose current step belongs to the referral flow: waiting to be sent,
 * waiting on the agency, or resting on a referral nobody followed up with a new
 * assignment. Those students are listed under งานส่งต่อ, not กลุ่มเสี่ยง. Uses
 * the `c` alias.
 */
const CASE_IN_REFERRAL_FLOW_SQL = `(
  c.status IN ('AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME')
  OR EXISTS (
    SELECT 1 FROM case_referrals flow_referral
    WHERE flow_referral.case_id = c.id
      AND flow_referral.status_code <> 'CANCELLED'
      AND NOT EXISTS (
        SELECT 1 FROM tasks flow_task
        WHERE flow_task.case_id = c.id
          AND flow_task.deleted_at IS NULL
          AND flow_task.created_at > flow_referral.referred_at
      )
  )
)`;

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
    actor: CaseScopeContext | undefined,
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
        sort_order,
        default_permissions,
        scope_mode,
        scope_policy,
        is_assignable,
        is_system
      FROM roles
      WHERE is_assignable = TRUE
      ORDER BY sort_order DESC, name ASC
    `);

    return result.rows.map((row: QueryResultRow) => ({
      id: Number(row.id),
      name: normalizeScalar(row.name),
      label: normalizeScalar(row.label),
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
          membership.teacher_id::text AS teacher_id,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) AS display_name,
          teacher_person.email,
          EXISTS (
            SELECT 1
            FROM classroom_homeroom_teacher_assignments assignment
            WHERE assignment.classroom_id = current_student.classroom_id
              AND assignment.teacher_membership_id = membership.id
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
        ORDER BY
          is_homeroom DESC,
          -- With two homeroom teachers the first one (the primary) leads, so
          -- the dialog's default pick is the room's ครูหลัก, not whichever
          -- name sorts first.
          EXISTS (
            SELECT 1
            FROM classroom_homeroom_teacher_assignments primary_assignment
            WHERE primary_assignment.classroom_id = current_student.classroom_id
              AND primary_assignment.teacher_membership_id = membership.id
              AND primary_assignment.is_primary
          ) DESC,
          TRIM(teacher_person.first_name || ' ' || teacher_person.last_name) COLLATE "th-x-icu",
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

  async findCaseDetailById(
    caseId: number,
    actor?: CaseScopeContext,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        c.id,
        c.student_uuid::text AS student_id,
        -- cases.student_name / student_school are text snapshots taken when the
        -- case opened; an edited student or a renamed school (e.g.
        -- 20260827313400-RelocateBuraphaSchool) leaves them stale, so the
        -- current enrollment and school rows win.
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', student."FirstName_Onec", student."LastName_Onec")), ''),
          c.student_name
        ) AS student_name,
        COALESCE(case_school.name, c.student_school) AS student_school,
        c.student_address,
        -- The case's own pin (set when it opened, or corrected by a follow-up
        -- submission) wins; a case opened before the student had one falls back
        -- to the location saved on the student since. Taken as a pair so a pin
        -- never mixes two sources.
        CASE WHEN c.student_lat IS NOT NULL AND c.student_lng IS NOT NULL
          THEN c.student_lat ELSE student.address_latitude END AS student_lat,
        CASE WHEN c.student_lat IS NOT NULL AND c.student_lng IS NOT NULL
          THEN c.student_lng ELSE student.address_longitude END AS student_lng,
        -- The student's current address parts, so the case map reads the same
        -- address (and approximate pin) as the student profile does.
        student.address_house_no,
        student."VillageNumber_Onec",
        student."Trok_Onec",
        student."Soi_Onec",
        student."Street_Onec",
        student."SubDistrictNameThai_Onec",
        student."DistrictNameThai_Onec",
        student."ProvinceNameThai_Onec",
        student."PostalCode_Onec",
        c.reason_flagged,
        c.status,
        case_status.label_th AS status_label,
        c.completion_outcome_code,
        completion_outcome.label_th AS completion_outcome_label,
        c.workflow_phase_code,
        CASE
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
          latest_comment.problem_description,
          c.reason_flagged
        ) AS teacher_comment,
        latest_task.id AS task_id
      FROM cases c
      INNER JOIN case_workflow_statuses case_status ON case_status.code = c.status
      LEFT JOIN case_completion_outcomes completion_outcome
        ON completion_outcome.code = c.completion_outcome_code
      LEFT JOIN case_workflow_phases case_phase
        ON case_phase.code = c.workflow_phase_code
      LEFT JOIN schools case_school ON case_school.id = c.school_id
      LEFT JOIN student_term student ON student.student_uuid = c.student_uuid
      LEFT JOIN student_person person ON person.person_uuid = student.person_uuid
      LEFT JOIN student_person_contact person_contact ON person_contact.person_uuid = student.person_uuid
      LEFT JOIN grade_levels grade ON grade.id = student."GradeLevelID_Onec"
      LEFT JOIN LATERAL (
        SELECT comment.problem_description
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
    actor: CaseScopeContext,
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
    actor: CaseScopeContext,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const result = await executor.query<QueryResultRow>(
      `
      SELECT c.id
      FROM cases c
      WHERE c.student_uuid = $1
        AND c.status IN (
          'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL',
          'AWAITING_REFERRAL_OUTCOME'
        )
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
        created_by_teacher_id,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $16)
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
        data.createdByTeacherId ?? null,
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

  /** Lock the case before checking its newest round; never reuse an older success. */
  async lockCaseWithSuccessfulLatestOutcome(
    caseId: number,
    executor: QueryExecutor,
    actor?: ActorContext,
  ): Promise<boolean> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    const locked = await executor.query(
      `SELECT c.id FROM cases c WHERE c.id = $1 AND c.status = 'PENDING_REVIEW'
         AND c.deleted_at IS NULL${scopeSql} FOR UPDATE OF c`,
      [caseId, ...scopeQuery.params],
    );
    if (locked.rows.length !== 1) return false;
    // A separate statement gets a fresh snapshot after any concurrent writer
    // releases the case lock, so its newest result cannot be read stale.
    const result = await executor.query(
      `SELECT (
         SELECT round.outcome_code = 'SUCCEEDED'
         FROM (
           SELECT task.created_at AS started_at, task.id::text AS round_id,
             submission.task_execution_outcome_code AS outcome_code
           FROM tasks task
           LEFT JOIN LATERAL (
             SELECT report.task_execution_outcome_code
             FROM task_links link
             JOIN task_submissions report ON report.task_link_id = link.id
             WHERE link.task_id = task.id AND link.deleted_at IS NULL
               AND report.deleted_at IS NULL
             ORDER BY report.submitted_at DESC, report.id DESC LIMIT 1
           ) submission ON TRUE
           WHERE task.case_id = c.id AND task.deleted_at IS NULL
           UNION ALL
           SELECT referral.referred_at, referral.id::text,
             CASE WHEN result.case_referral_id IS NOT NULL
               AND referral.status_code = 'COMPLETED' THEN 'SUCCEEDED'
               ELSE 'NOT_SUCCEEDED' END
           FROM case_referrals referral
           LEFT JOIN case_referral_results result ON result.case_referral_id = referral.id
           WHERE referral.case_id = c.id
         ) round
         ORDER BY round.started_at DESC, round.round_id DESC LIMIT 1
       ) AS can_close
       FROM cases c
       WHERE c.id = $1`,
      [caseId],
    );
    return result.rows[0]?.can_close === true;
  }

  /**
   * Withdraws the assignment a case is currently waiting on.
   *
   * Only an assignment nobody has reported on can be withdrawn — a submitted
   * round is history, not a mistake to undo. The link dies with the same effect
   * as expiry (the holder can no longer open it), the task keeps its row so the
   * case history still shows the round happened, and the case drops back to
   * รอมอบหมาย inside whatever phase it was already in.
   */
  async cancelCaseAssignment(
    caseId: number,
    reason: string,
    actorId: number | null,
    actor?: ActorContext,
  ): Promise<{ taskId: string; assignee: string | null; taskType: string | null } | null> {
    return await this.withTransaction(async (executor) => {
      const scopeQuery = this.buildCaseScopeQuery(actor, 2);
      const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
      const target = await executor.query<{
        task_id: string;
        link_id: string;
        assignee: string | null;
        task_type: string | null;
      }>(
        `
          SELECT t.id AS task_id, tl.id AS link_id, tl.assigned_to_name AS assignee,
                 t.task_type
          FROM cases c
          JOIN tasks t ON t.case_id = c.id AND t.deleted_at IS NULL
          JOIN task_links tl ON tl.task_id = t.id AND tl.deleted_at IS NULL
          WHERE c.id = $1
            AND c.deleted_at IS NULL
            AND c.status = 'IN_PROGRESS'
            AND tl.status IN ('ACTIVE', 'SCHEDULED')
            AND NOT EXISTS (
              SELECT 1 FROM task_submissions submission
              WHERE submission.task_link_id = tl.id AND submission.deleted_at IS NULL
            )${scopeSql}
          ORDER BY t.created_at DESC
          LIMIT 1
          FOR UPDATE OF tl
        `,
        [caseId, ...scopeQuery.params],
      );
      const row = target.rows[0];
      if (!row) return null;
      await executor.query(
        `
          UPDATE task_links
          SET status = 'CANCELLED',
              cancelled_at = now(),
              cancelled_by = $2,
              cancel_reason = $3,
              updated_by = $2
          WHERE id = $1
        `,
        [row.link_id, actorId, reason],
      );
      await executor.query(`UPDATE tasks SET status = 'CANCELLED', updated_by = $2 WHERE id = $1`, [
        row.task_id,
        actorId,
      ]);
      await executor.query(`UPDATE cases SET status = 'OPEN' WHERE id = $1`, [caseId]);
      return {
        taskId: row.task_id,
        assignee: row.assignee ?? null,
        taskType: row.task_type ?? null,
      };
    });
  }

  /**
   * Closes every assignment whose link ran out with no report and hands the
   * case back to รอมอบหมาย.
   *
   * Expiry used to be read-side only — the link stopped working but the case
   * still read รอติดตาม, so a case waiting for a new assignment looked like a
   * case someone was working on. This makes the state real, which is what the
   * case list, the counters and the reminder all read.
   */
  async expireLapsedAssignments(): Promise<Array<{ caseId: number; taskId: string }>> {
    const result = await this.query<{ case_id: number; task_id: string }>(
      `
        WITH lapsed AS (
          UPDATE task_links tl
          SET status = 'EXPIRED'
          WHERE tl.status IN ('ACTIVE', 'SCHEDULED')
            AND tl.deleted_at IS NULL
            AND tl.expires_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM task_submissions submission
              WHERE submission.task_link_id = tl.id AND submission.deleted_at IS NULL
            )
          RETURNING tl.task_id
        ),
        lapsed_tasks AS (
          UPDATE tasks t
          SET status = 'EXPIRED'
          FROM lapsed
          WHERE t.id = lapsed.task_id AND t.deleted_at IS NULL
          RETURNING t.id AS task_id, t.case_id
        )
        UPDATE cases c
        SET status = 'OPEN'
        FROM lapsed_tasks
        WHERE c.id = lapsed_tasks.case_id
          AND c.status = 'IN_PROGRESS'
          AND c.deleted_at IS NULL
        RETURNING c.id AS case_id, lapsed_tasks.task_id
      `,
    );
    return result.rows.map((row) => ({ caseId: row.case_id, taskId: row.task_id }));
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
        assigned_teacher_id,
        expires_at,
        subject,
        assignment_note,
        subject_id,
        created_by,
        updated_by,
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
        $15,
        $16
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
        data.assignedTeacherId,
        data.expiresAt,
        data.subject,
        data.assignmentNote,
        data.subjectId,
        data.createdBy,
        data.opensAt,
      ],
    );
  }

  async findTaskLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.*,
        COALESCE(
          NULLIF(TRIM(current_assignee_teacher.first_name || ' ' || current_assignee_teacher.last_name), ''),
          tl.assigned_to_name
        ) AS current_assignee_name,
        current_assignee_teacher.photo_storage_key AS assignee_photo_storage_key,
        current_assignee_teacher.updated_at AS assignee_photo_updated_at,
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
      LEFT JOIN teachers current_assignee_teacher
        ON current_assignee_teacher.id = tl.assigned_teacher_id
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
    return await this.findPublicLinkCase(
      'JOIN tasks t ON t.case_id = c.id',
      't.id = $1 AND t.deleted_at IS NULL',
      taskId,
    );
  }

  /**
   * The case a referral link reports on, in the same shape the follow-up link
   * reads — the agency's page shows what the teacher's page shows (owner,
   * 2026-10-08).
   */
  async findCaseForReferralLink(caseId: number): Promise<QueryResultRow | null> {
    return await this.findPublicLinkCase('', 'c.id = $1', caseId);
  }

  private async findPublicLinkCase(
    joinSql: string,
    whereSql: string,
    param: unknown,
  ): Promise<QueryResultRow | null> {
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
        -- Case pin first, else the student's saved location (see findCaseDetailById).
        CASE WHEN c.student_lat IS NOT NULL AND c.student_lng IS NOT NULL
          THEN c.student_lat ELSE enrollment.address_latitude END AS student_lat,
        CASE WHEN c.student_lat IS NOT NULL AND c.student_lng IS NOT NULL
          THEN c.student_lng ELSE enrollment.address_longitude END AS student_lng,
        c.reason_flagged,
        c.status,
        c.workflow_phase_code,
        CASE
          WHEN c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW')
            AND case_phase.label_th IS NOT NULL
            THEN CONCAT(case_status.label_th, ' : ', case_phase.label_th)
          ELSE case_status.label_th
        END AS display_status_label,
        person_contact.phone AS student_phone,
        enrollment."AcademicYear_Onec" AS academic_year,
        enrollment."Semester_Onec" AS semester,
        grade.label AS grade,
        enrollment."RoomID_Onec"::text AS room,
        person.photo_storage_key AS student_photo_storage_key,
        person.updated_at AS student_photo_updated_at,
        -- The student's own address parts, so a link without a pin can look up
        -- the same approximate spot the case page shows (same text, same cache).
        c.student_uuid,
        enrollment.address_house_no,
        enrollment."VillageNumber_Onec",
        enrollment."Trok_Onec",
        enrollment."Soi_Onec",
        enrollment."Street_Onec",
        enrollment."SubDistrictNameThai_Onec",
        enrollment."DistrictNameThai_Onec",
        enrollment."ProvinceNameThai_Onec",
        enrollment."PostalCode_Onec"
      FROM cases c
      ${joinSql}
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
      LEFT JOIN student_person person ON person.person_uuid = enrollment.person_uuid
      LEFT JOIN grade_levels grade ON grade.id = enrollment."GradeLevelID_Onec"
      WHERE ${whereSql} AND c.deleted_at IS NULL
      `,
      [param],
    );

    return result.rows[0] || null;
  }

  /**
   * The student's last visits across every case they have had, not only the
   * case this link belongs to: a new case opened after an old one closed would
   * otherwise start with an empty history and hide that someone already went.
   */
  async listStudentFollowUpHistory(
    caseId: number,
    limit: number,
    access: { actor: CaseScopeContext } | { publicCase: true },
  ): Promise<QueryResultRow[]> {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 5;
    const boundedLimit = Math.max(1, Math.min(normalizedLimit, 5));
    // Staff history follows the authenticated scope. Public links are confined
    // to the school of the case already authorized by their token.
    const scope =
      'actor' in access
        ? this.buildCaseScopeQuery(access.actor, 3, 'history_case')
        : {
            sql: `(history_case.id = $1 OR history_case.school_id = (
            SELECT school_id FROM cases WHERE id = $1 AND deleted_at IS NULL
          ))`,
            params: [],
          };
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
        problem_category.label_th AS follow_up_problem_category_label,
        problem_category.guidance_th AS follow_up_problem_category_guidance,
        exception.label_th AS exception_label
      FROM tasks task
      JOIN cases history_case ON history_case.id = task.case_id AND history_case.deleted_at IS NULL
      JOIN task_links link
        ON link.task_id = task.id
        AND link.deleted_at IS NULL
      JOIN task_submissions submission
        ON submission.task_link_id = link.id
        AND submission.deleted_at IS NULL
      LEFT JOIN follow_up_problem_categories problem_category
        ON problem_category.code = submission.follow_up_problem_category_code
      LEFT JOIN home_visit_exception_options exception
        ON exception.code = submission.home_visit_exception_code
      -- A case names one term's enrollment, so the student's other cases are
      -- found through the person behind it; the current case always counts.
      WHERE task.case_id IN (
          SELECT sibling.id
          FROM cases current_case
          JOIN student_term current_term ON current_term.student_uuid = current_case.student_uuid
          JOIN student_term sibling_term ON sibling_term.person_uuid = current_term.person_uuid
          JOIN cases sibling ON sibling.student_uuid = sibling_term.student_uuid
          WHERE current_case.id = $1
            AND sibling.deleted_at IS NULL
          UNION
          SELECT $1::int
        )
        ${scope.sql ? `AND (${scope.sql})` : ''}
        AND task.task_type = 'VISIT'
        AND task.deleted_at IS NULL
      ORDER BY submission.submitted_at DESC, submission.id DESC
      LIMIT $2
      `,
      [caseId, boundedLimit, ...scope.params],
    );
    return result.rows;
  }

  async findRepeatVisitPrefill(
    caseId: number,
    currentTaskId: string,
  ): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      WITH ranked_visits AS (
        SELECT
          submission.id AS source_submission_id,
          task.id AS source_task_id,
          submission.submitted_at AS source_submitted_at,
          ROW_NUMBER() OVER (
            ORDER BY task.created_at, submission.submitted_at, submission.id
          ) AS source_round_number,
          submission.parental_status_code,
          submission.guardian_type_code,
          submission.guardian_type_detail,
          submission.contact_person_name,
          submission.contact_channel_code,
          submission.residence_environment_detail,
          COALESCE((
            SELECT json_agg(environment.residence_environment_code ORDER BY environment.residence_environment_code)
            FROM task_submission_residence_environments environment
            WHERE environment.task_submission_id = submission.id
          ), '[]'::json) AS residence_environment_codes
        FROM tasks task
        JOIN task_links link
          ON link.task_id = task.id
          AND link.deleted_at IS NULL
        JOIN task_submissions submission
          ON submission.task_link_id = link.id
          AND submission.deleted_at IS NULL
        WHERE task.case_id = $1
          AND task.task_type = 'VISIT'
          AND task.deleted_at IS NULL
      )
      SELECT *
      FROM ranked_visits
      WHERE source_task_id <> $2
      ORDER BY source_submitted_at DESC, source_submission_id DESC
      LIMIT 1
      `,
      [caseId, currentTaskId],
    );
    return result.rows[0] || null;
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

  // Chain view — explicit safe column list (no token_hash, assigned_to_phone,
  // or login fields) to keep secrets out of the task-chain response.
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
        submission.follow_up_problem_category_code,
        problem_category.label_th AS follow_up_problem_category_label,
        problem_category.guidance_th AS follow_up_problem_category_guidance,
        submission.absence_reason_code,
        absence_reason.label_th AS absence_reason_label,
        absence_category.label_th AS absence_reason_category_label,
        submission.parental_status_code,
        parental_status.label_th AS parental_status_label,
        submission.guardian_type_code,
        guardian_type.label_th AS guardian_type_label,
        submission.guardian_type_detail,
        submission.residence_environment_detail,
        ${RESIDENCE_ENVIRONMENTS_JSON_SQL} AS residence_environments,
        submission.task_execution_outcome_code,
        CASE
          WHEN chain_task.task_type = 'VISIT'
          THEN COALESCE(execution_outcome.visit_label_th, execution_outcome.label_th)
          ELSE execution_outcome.label_th
        END AS task_execution_outcome_label,
        submission.execution_outcome_detail,
        submission.contact_person_name,
        submission.contact_channel_code,
        contact_channel.label_th AS contact_channel_label,
        submission.non_follow_up_reason_code,
        non_follow_up_reason.label_th AS non_follow_up_reason_label,
        submission.cause_detail,
        submission.recommendation,
        submission.submitted_at,
        submission.visit_lat,
        submission.visit_lng,
        submission.photo_paths
      FROM task_submissions submission
      LEFT JOIN follow_up_problem_categories problem_category
        ON problem_category.code = submission.follow_up_problem_category_code
      LEFT JOIN absence_reasons absence_reason
        ON absence_reason.code = submission.absence_reason_code
      LEFT JOIN absence_reason_categories absence_category
        ON absence_category.code = COALESCE(
          submission.absence_reason_category_code,
          absence_reason.category_code
        )
      LEFT JOIN parental_status_options parental_status
        ON parental_status.code = submission.parental_status_code
        AND parental_status.deleted_at IS NULL
      LEFT JOIN guardian_type_options guardian_type
        ON guardian_type.code = submission.guardian_type_code
        AND guardian_type.deleted_at IS NULL
      LEFT JOIN task_execution_outcome_options execution_outcome
        ON execution_outcome.code = submission.task_execution_outcome_code
      LEFT JOIN non_follow_up_reason_options non_follow_up_reason
        ON non_follow_up_reason.code = submission.non_follow_up_reason_code
      LEFT JOIN contact_channel_options contact_channel
        ON contact_channel.code = submission.contact_channel_code
      JOIN task_links chain_link ON chain_link.id = submission.task_link_id
      JOIN tasks chain_task ON chain_task.id = chain_link.task_id
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
        c.student_uuid,
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

  async insertTaskSubmission(data: TaskSubmissionInput, executor?: QueryExecutor): Promise<number> {
    const inserted = await this.getExecutor(executor).query<{ id: number } & QueryResultRow>(
      `
      INSERT INTO task_submissions (
        task_link_id,
        visit_lat,
        visit_lng,
        visited_at,
        follow_up_problem_category_code,
        absence_reason_category_code,
        absence_reason_code,
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
        assistance_detail,
        task_execution_outcome_code,
        execution_outcome_detail,
        contact_person_name,
        contact_channel_code,
        non_follow_up_reason_code
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33
      )
      RETURNING id
    `,
      [
        data.linkId,
        data.visitLat,
        data.visitLng,
        data.visitedAt,
        data.followUpProblemCategoryCode,
        data.absenceReasonCategoryCode,
        data.absenceReasonCode,
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
        data.taskExecutionOutcomeCode,
        data.executionOutcomeDetail,
        data.contactPersonName,
        data.contactChannelCode,
        data.nonFollowUpReasonCode,
      ],
    );

    const submissionId = inserted.rows[0]?.id;
    if (submissionId == null) {
      throw new Error('task submission insert did not return an id');
    }
    if (data.residenceEnvironmentCodes.length === 0) return submissionId;
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
    return submissionId;
  }

  async insertHomeVisitCareObservations(
    submissionId: number,
    studentUuid: string,
    disadvantageTypeCodes: string[],
    disabilityTypeCodes: string[],
    executor?: QueryExecutor,
  ): Promise<void> {
    const target = this.getExecutor(executor);
    if (disadvantageTypeCodes.length > 0) {
      await target.query(
        `
          INSERT INTO home_visit_disadvantage_observations (
            task_submission_id, disadvantage_type_code
          )
          SELECT $1, code FROM unnest($2::varchar[]) AS code
        `,
        [submissionId, disadvantageTypeCodes],
      );
      await target.query(
        `
          INSERT INTO student_term_disadvantages (
            student_uuid, disadvantage_type_code, recorded_at, recorded_by_user_id
          )
          SELECT $1, code, now(), NULL FROM unnest($2::varchar[]) AS code
          ON CONFLICT (student_uuid, disadvantage_type_code) DO UPDATE SET
            recorded_at = EXCLUDED.recorded_at
        `,
        [studentUuid, disadvantageTypeCodes],
      );
    }
    if (disabilityTypeCodes.length > 0) {
      await target.query(
        `
          INSERT INTO home_visit_disability_observations (
            task_submission_id, disability_type_code
          )
          SELECT $1, code FROM unnest($2::varchar[]) AS code
        `,
        [submissionId, disabilityTypeCodes],
      );
      await target.query(
        `
          INSERT INTO student_disabilities (
            student_uuid, disability_type_code, recorded_at, recorded_by_user_id
          )
          SELECT $1, code, now(), NULL FROM unnest($2::varchar[]) AS code
          ON CONFLICT (student_uuid, disability_type_code) DO UPDATE SET
            recorded_at = EXCLUDED.recorded_at
        `,
        [studentUuid, disabilityTypeCodes],
      );
    }
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

  /**
   * A visit that found the student at a new address moves the student's own
   * record with it, so the profile, the next case and the next visit all start
   * from what the teacher saw. The form takes the street part as one free line,
   * so it lands in the house-number column and the other street parts clear —
   * keeping them would glue the old soi/road onto the new address. The pin
   * comes along when one was set; the address text alone never wipes it.
   */
  async updateStudentHomeFromVisit(
    input: {
      studentUuid: string;
      addressLine: string;
      subDistrict: string;
      district: string;
      province: string;
      postalCode: string;
      lat: number | null;
      lng: number | null;
    },
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.getExecutor(executor).query(
      `
        UPDATE student_term
        SET address_house_no = $2,
            "VillageNumber_Onec" = NULL,
            "Trok_Onec" = NULL,
            "Soi_Onec" = NULL,
            "Street_Onec" = NULL,
            "SubDistrictNameThai_Onec" = $3,
            "DistrictNameThai_Onec" = $4,
            "ProvinceNameThai_Onec" = $5,
            "PostalCode_Onec" = $6,
            address_latitude = CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
              THEN $7::float8 ELSE address_latitude END,
            address_longitude = CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
              THEN $8::float8 ELSE address_longitude END,
            updated_at = now()
        WHERE student_uuid = $1::uuid
          AND deleted_at IS NULL
      `,
      [
        input.studentUuid,
        input.addressLine,
        input.subDistrict,
        input.district,
        input.province,
        input.postalCode,
        input.lat,
        input.lng,
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

  /**
   * Lock a link row and confirm the link + its parent task are both live.
   * Returns null if either is tombstoned. Call at the start of a submit/write
   * transaction so a tombstone that commits after token validation can't be
   * raced: the tombstoning UPDATE and this `FOR UPDATE` serialize on the same row.
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
   * Admin link detail by id — explicit safe column list (no token_hash)
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
          tl.assigned_to_name
        ) AS active_link_assigned_to,
        latest_link.id AS latest_link_id,
        latest_link.status AS latest_link_status,
        CASE
          WHEN c.status <> 'RESOLVED' THEN COALESCE(
            NULLIF(TRIM(latest_assignee_teacher.first_name || ' ' || latest_assignee_teacher.last_name), ''),
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
      LEFT JOIN teachers active_assignee_teacher
        ON active_assignee_teacher.id = tl.assigned_teacher_id
       AND active_assignee_teacher.deleted_at IS NULL
      LEFT JOIN teachers latest_assignee_teacher
        ON latest_assignee_teacher.id = latest_link.assigned_teacher_id
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
      `SELECT count(*) FROM cases c WHERE c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND', 'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME') AND c.deleted_at IS NULL${scopeSql}`,
      scopeQuery.params,
    );

    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async countAtRiskStudents(actor?: ActorContext): Promise<number> {
    const activeStatuses = [
      'OPEN',
      'IN_PROGRESS',
      'PENDING_REVIEW',
      'STUDENT_NOT_FOUND',
      'AWAITING_REFERRAL',
      'AWAITING_REFERRAL_OUTCOME',
    ];
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

  async getRiskDashboardFilterOptions(
    actor: ActorContext,
    filters: RiskDashboardFilterOptionsFilters = {},
  ): Promise<RiskDashboardFilterOptions> {
    if (actor.data_scope?.own_only === true || isUnconfiguredDataScope(actor.data_scope)) {
      return { grades: [], rooms: [], terms: [] };
    }

    const scope = buildDataScopeQuery(actor.data_scope ?? {}, {
      school_id: 's."SchoolID_Onec"',
      grade: 's."GradeLevelID_Onec"',
      room: 's."RoomID_Onec"::text',
      province: 'sc.province',
      district: 'sc.district',
      sub_district: 'sc.sub_district',
    });
    const params: unknown[] = [...scope.params];
    const conditions = scope.sql ? [`(${scope.sql})`] : [];
    for (const [column, value] of [
      ['sc.province', filters.province],
      ['sc.district', filters.district],
      ['sc.sub_district', filters.subDistrict],
      ['s."SchoolID_Onec"', filters.schoolId],
    ] as const) {
      if (value !== undefined && value !== '') {
        params.push(value);
        conditions.push(`${column} = $${params.length}`);
      }
    }
    const termConditions: string[] = [];
    for (const [column, value] of [
      ['academic_year', filters.academicYear],
      ['semester', filters.semester],
    ] as const) {
      if (value !== undefined) {
        params.push(value);
        termConditions.push(`${column} = $${params.length}`);
      }
    }
    let roomGradeCondition = '';
    if (filters.grade) {
      params.push(filters.grade);
      roomGradeCondition = `AND grade_label = $${params.length}`;
    }
    // Choices cover retained enrollment history as well as the current term.
    // Authorization and requested geography apply before options aggregation.
    const result = await this.query<QueryResultRow & RiskDashboardFilterOptions>(
      `WITH scoped_enrollments AS (
        SELECT
          gl.id AS grade_id,
          gl.label AS grade_label,
          s."RoomID_Onec"::text AS room,
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester
        FROM student_term s
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        WHERE s.deleted_at IS NULL${conditions.length ? ` AND ${conditions.join(' AND ')}` : ''}
      ), selected_term_enrollments AS (
        SELECT * FROM scoped_enrollments
        ${termConditions.length ? `WHERE ${termConditions.join(' AND ')}` : ''}
      )
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('value', grade_label, 'label', grade_label)
                           ORDER BY grade_id, grade_label)
          FROM (
            SELECT grade_label, MIN(grade_id) AS grade_id
            FROM selected_term_enrollments
            WHERE grade_label IS NOT NULL AND TRIM(grade_label) <> ''
            GROUP BY grade_label
          ) grades
        ), '[]'::jsonb) AS grades,
        COALESCE((
          SELECT jsonb_agg(room ORDER BY LENGTH(room), room)
          FROM (
            SELECT DISTINCT room FROM selected_term_enrollments
            WHERE room IS NOT NULL AND TRIM(room) <> '' ${roomGradeCondition}
          ) rooms
        ), '[]'::jsonb) AS rooms,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('academicYear', academic_year, 'semester', semester)
                           ORDER BY academic_year DESC, semester DESC)
          FROM (
            SELECT DISTINCT academic_year, semester FROM scoped_enrollments
            WHERE academic_year > 0 AND semester > 0
          ) terms
        ), '[]'::jsonb) AS terms`,
      params,
    );
    const options = result.rows[0];
    return {
      grades: options?.grades ?? [],
      rooms: options?.rooms ?? [],
      terms: options?.terms ?? [],
    };
  }

  async listRiskDashboardStudents(
    actor: ActorContext,
    filters: RiskDashboardFilters,
    thresholds: RiskDashboardThresholds,
  ): Promise<RiskDashboardResult> {
    if (actor.data_scope?.own_only === true || isUnconfiguredDataScope(actor.data_scope)) {
      return {
        rows: [],
        totalCount: 0,
        summary: { ...EMPTY_RISK_DASHBOARD_SUMMARY },
        caseStatusSummary: { ...EMPTY_RISK_DASHBOARD_CASE_STATUS_SUMMARY },
        concernLevelSummary: { ...EMPTY_RISK_DASHBOARD_CONCERN_LEVEL_SUMMARY },
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
        `(s."FirstName_Onec" || ' ' || s."LastName_Onec") ILIKE $${params.length} ESCAPE '\\'`,
      );
    }

    conditions.push('s.deleted_at IS NULL');
    // A risk row exists only once a case was opened, and leaves for งานส่งต่อ
    // while that case is in the referral flow. A watchlist row exists only
    // after a teacher left a comment for that enrollment's classroom. Keep that
    // product distinction in SQL before pagination and counting.
    const studentGroupConditions =
      filters.studentGroup === 'RISK'
        ? [...conditions, 'latest_case.id IS NOT NULL', 'NOT latest_case.in_referral_flow']
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
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester,
          sc.name AS school_name,
          COALESCE(profile.consecutive_absent_days, 0)::int AS consecutive_absent_days,
          COALESCE(profile.absent_days_since_case_reset, 0)::int AS absent_days_since_case_reset,
          COALESCE(profile.term_absent_days, 0)::int AS term_absent_days,
          profile.absence_reset_after_date,
          COALESCE(profile.late_count, 0)::int AS late_count,
          COALESCE(profile.subject_late_count, 0)::int AS subject_late_count,
          COALESCE(profile.recorded_day_count, 0)::int AS recorded_day_count,
          profile.attendance_rate_percent,
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
          latest_case_assignment.had_assignment AS latest_case_had_assignment,
          latest_comment.id AS latest_comment_id,
          latest_comment.problem_category_label,
          latest_comment.concern_level_code,
          latest_comment.concern_level_label,
          COALESCE(comment_totals.comment_count, 0) AS comment_count,
          COALESCE(comment_totals.pending_comment_count, 0) AS pending_comment_count,
          COALESCE(
            latest_comment.problem_description,
            CASE
              WHEN profile.absence_reset_after_date IS NULL
                THEN CONCAT('ขาดสะสมทั้งเทอม ', COALESCE(profile.term_absent_days, 0), ' วัน')
              ELSE CONCAT(
                'ขาดสะสมทั้งเทอม ', COALESCE(profile.term_absent_days, 0),
                ' วัน · หลังปิดเคสล่าสุด ', COALESCE(profile.absent_days_since_case_reset, 0), ' วัน'
              )
            END
          ) AS teacher_comment,
          (profile.student_uuid IS NULL) AS missing_profile
        FROM student_term s
        LEFT JOIN student_person person ON person.person_uuid = s.person_uuid
        LEFT JOIN grade_levels gl ON s."GradeLevelID_Onec" = gl.id
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        LEFT JOIN LATERAL (
          ${CASE_COMMENT_COMPLETION_BASELINE_SQL}
        ) comment_baseline ON TRUE
        LEFT JOIN LATERAL (
          SELECT c.id, c.status, c.updated_at, c.reason_flagged,
            ${CASE_IN_REFERRAL_FLOW_SQL} AS in_referral_flow
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
          -- Distinguishes a case that never had an assignment from one whose
          -- link expired/was cancelled and fell back to OPEN, so the dashboard
          -- can warn "needs reassignment" only for the latter.
          SELECT EXISTS (
            SELECT 1 FROM tasks task
            WHERE task.case_id = latest_case.id AND task.deleted_at IS NULL
          ) AS had_assignment
        ) latest_case_assignment ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            comment.id,
            category.label_th AS problem_category_label,
            comment.problem_description,
            concern_level.code AS concern_level_code,
            concern_level.label_th AS concern_level_label
          FROM classroom_student_comments comment
          JOIN classroom_student_problem_categories category
            ON category.code = comment.problem_category_code
          JOIN classroom_student_comment_concern_levels concern_level
            ON concern_level.code = comment.concern_level_code
          WHERE comment.classroom_id = s.classroom_id
            AND comment.person_uuid = s.person_uuid
          -- Prefer this round's observations over completed history. Within
          -- the round, severity wins and recency breaks ties.
          ORDER BY
            (comment.created_at > COALESCE(comment_baseline.completed_at, '-infinity'::timestamptz)) DESC,
            concern_level.sort_order DESC, comment.created_at DESC, comment.id DESC
          LIMIT 1
        ) latest_comment ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS comment_count,
            COUNT(*) FILTER (
              WHERE comment.created_at > COALESCE(comment_baseline.completed_at, '-infinity'::timestamptz)
            )::int AS pending_comment_count
          FROM classroom_student_comments comment
          WHERE comment.classroom_id = s.classroom_id
            AND comment.person_uuid = s.person_uuid
        ) comment_totals ON TRUE
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
    const filteredConditions: string[] = [];
    if (filters.caseStatus) {
      filteredParams.push(filters.caseStatus);
      filteredConditions.push(`latest_case_status = $${filteredParams.length}`);
    }
    // No default level filter: the watchlist is every student a teacher has
    // written about, and the three level cards partition exactly that set. A
    // default that hid one level made the cards add up to more than the rows,
    // which reads as a broken count rather than as a deliberate omission.
    if (filters.studentGroup === 'WATCHLIST' && filters.concernLevel) {
      filteredParams.push(filters.concernLevel);
      filteredConditions.push(`concern_level_code = $${filteredParams.length}`);
    }
    const filteredWhere =
      filteredConditions.length > 0 ? `WHERE ${filteredConditions.join(' AND ')}` : '';
    const filteredCte = `${scopedCte}, filtered AS (SELECT * FROM risk_scoped ${filteredWhere})`;

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
          COUNT(*) FILTER (WHERE latest_case_status = 'STUDENT_NOT_FOUND')::int AS case_student_not_found_count,
          COUNT(*) FILTER (WHERE concern_level_code = 'NOTE')::int AS concern_note_count,
          COUNT(*) FILTER (WHERE concern_level_code = 'WATCH')::int AS concern_watch_count,
          COUNT(*) FILTER (WHERE concern_level_code = 'CONCERN')::int AS concern_count
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

    const concernLevelSummary: RiskDashboardConcernLevelSummary = {
      NOTE: Number.parseInt(String(summaryResult.rows[0]?.concern_note_count || '0'), 10),
      WATCH: Number.parseInt(String(summaryResult.rows[0]?.concern_watch_count || '0'), 10),
      CONCERN: Number.parseInt(String(summaryResult.rows[0]?.concern_count || '0'), 10),
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
                ? `attendance_rate_percent ${sortDirection} NULLS LAST, risk_severity DESC, student_name ASC`
                : filters.sortBy === 'openCases'
                  ? `open_case_count ${sortDirection}, risk_severity DESC, risk_score DESC, student_name ASC`
                  : filters.sortBy === 'updatedAt'
                    ? `latest_case_at ${sortDirection} NULLS LAST, student_name ASC`
                    : filters.sortBy === 'problemCategory'
                      ? `problem_category_label ${sortDirection} NULLS LAST, student_name ASC`
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
          academic_year,
          semester,
          consecutive_absent_days,
          absent_days_since_case_reset,
          term_absent_days,
          absence_reset_after_date,
          late_count,
          subject_late_count,
          recorded_day_count,
          attendance_rate_percent,
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
          latest_case_had_assignment,
          problem_category_label,
          concern_level_code,
          concern_level_label,
          comment_count,
          pending_comment_count,
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
      concernLevelSummary,
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
        source_actor_user_id,
        proposed_assistance_measure_detail
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        data.proposedAssistanceMeasureDetail,
      ],
    );
  }

  async insertCaseReviewAssistanceMeasures(
    reviewId: string,
    codes: string[],
    executor?: QueryExecutor,
  ): Promise<void> {
    if (codes.length === 0) return;
    await this.getExecutor(executor).query(
      `
        INSERT INTO case_review_assistance_measures (
          case_review_id, assistance_measure_code
        )
        SELECT $1, code FROM unnest($2::varchar[]) AS code
      `,
      [reviewId, codes],
    );
  }

  async findActiveReferralAgency(
    agencyId: number,
    executor?: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const result = await this.getExecutor(executor).query(
      `
        SELECT agency.id, agency.agency_name, agency.agency_kind_code,
          kind.label_th AS agency_kind_label_th
        FROM referral_agencies agency
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        WHERE agency.id = $1 AND agency.is_active = TRUE AND kind.is_active = TRUE
        LIMIT 1
        FOR KEY SHARE OF agency
      `,
      [agencyId],
    );
    return result.rows[0] ?? null;
  }

  async insertCaseReferral(
    data: {
      reviewId: string;
      caseId: number;
      agencyId: number;
      referredByUserId: number | null;
      note: string | null;
    },
    executor: QueryExecutor,
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `
        INSERT INTO case_referrals (
          case_review_id, case_id, referral_agency_id, referred_by_user_id,
          referral_note, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $4, $4)
        RETURNING id
      `,
      [data.reviewId, data.caseId, data.agencyId, data.referredByUserId, data.note],
    );
    return String(result.rows[0].id);
  }

  /**
   * Locks a case for sending a referral, with what deciding whether it may be
   * sent needs: the ส่งต่อหน่วยงาน review it hangs off, and the case's newest
   * referral with its newest link — the round this send would replace.
   */
  async lockCaseForReferral(
    caseId: number,
    actor: CaseScopeContext,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    const scopeQuery = this.buildCaseScopeQuery(actor, 2);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    // Read the latest referral in a fresh statement after acquiring the case
    // lock. A LATERAL read in the locking statement can keep the pre-wait
    // snapshot and let concurrent replacement sends both issue a new round.
    const locked = await executor.query<QueryResultRow>(
      `SELECT c.id FROM cases c WHERE c.id = $1 AND c.deleted_at IS NULL${scopeSql}
       FOR UPDATE OF c`,
      [caseId, ...scopeQuery.params],
    );
    if (locked.rows.length === 0) return null;
    const result = await executor.query<QueryResultRow>(
      `
        SELECT c.id, c.status, c.school_id, c.student_name, c.student_uuid::text,
          (
            SELECT review.id FROM case_reviews review
            WHERE review.case_id = c.id AND review.review_action = 'REFER_AGENCY'
            ORDER BY review.reviewed_at DESC, review.id DESC
            LIMIT 1
          ) AS refer_review_id,
          latest.id AS latest_referral_id,
          latest.status_code AS latest_referral_status,
          EXISTS (
            SELECT 1 FROM case_referral_results recorded
            WHERE recorded.case_referral_id = latest.id
          ) AS latest_has_result,
          latest_link.status_code AS latest_link_status,
          latest_link.expires_at AS latest_link_expires_at
        FROM cases c
        LEFT JOIN LATERAL (
          SELECT referral.id, referral.status_code
          FROM case_referrals referral
          WHERE referral.case_id = c.id
          ORDER BY referral.referred_at DESC, referral.id DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
          SELECT link.status_code, link.expires_at
          FROM case_referral_links link
          WHERE link.case_referral_id = latest.id
          ORDER BY link.created_at DESC, link.id DESC
          LIMIT 1
        ) latest_link ON true
        WHERE c.id = $1 AND c.deleted_at IS NULL${scopeSql}
      `,
      [caseId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Closes a sent referral that never got a result — withdrawn by the school,
   * or replaced after its link ran out or locked — the way a withdrawn round
   * closes its task link: the referral reads ยกเลิก, its open link dies, and
   * the why/who/when stay on its newest link.
   */
  async closeUnansweredReferral(
    referralId: string,
    data: { reason: string; cancelledByUserId: number | null },
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `
        UPDATE case_referral_links link
        SET status_code = CASE WHEN status_code = 'ACTIVE' THEN 'REVOKED' ELSE status_code END,
            cancelled_at = now(),
            cancelled_by_user_id = $2,
            cancel_reason = $3
        WHERE link.id = (
          SELECT newest.id FROM case_referral_links newest
          WHERE newest.case_referral_id = $1
          ORDER BY newest.created_at DESC, newest.id DESC
          LIMIT 1
        )
      `,
      [referralId, data.cancelledByUserId, data.reason],
    );
    await executor.query(
      `UPDATE case_referral_links SET status_code = 'REVOKED'
       WHERE case_referral_id = $1 AND status_code = 'ACTIVE'`,
      [referralId],
    );
    await executor.query(
      `UPDATE case_referrals SET status_code = 'CANCELLED', updated_by = $2 WHERE id = $1`,
      [referralId, data.cancelledByUserId],
    );
  }

  async setCaseStatus(
    caseId: number,
    data: { from: string[]; to: string; updatedByUserId: number | null },
    executor: QueryExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `
        UPDATE cases SET status = $2, completion_outcome_code = NULL, updated_by = $3
        WHERE id = $1 AND status = ANY($4::text[]) AND deleted_at IS NULL
        RETURNING id
      `,
      [caseId, data.to, data.updatedByUserId, data.from],
    );
    return result.rows.length === 1;
  }

  /**
   * Locks a referral and its case for recording the agency's result. Only the
   * case's latest referral can take a result: an older one was already
   * superseded by a later referral and is history.
   */
  async lockCaseReferralForResult(
    caseId: number,
    referralId: string,
    actor: CaseScopeContext | null,
    executor: QueryExecutor,
  ): Promise<QueryResultRow | null> {
    // `null` is the agency's referral link: its token, not a staff scope, is
    // what proved access to this one referral.
    const scopeQuery =
      actor === null ? { sql: '', params: [] } : this.buildCaseScopeQuery(actor, 3);
    const scopeSql = scopeQuery.sql ? ` AND ${scopeQuery.sql}` : '';
    // Match sendReferral's lock order: case -> referral -> link. Otherwise a
    // replacement send and an agency report can wait on each other's locks.
    const caseScope = actor === null ? { sql: '', params: [] } : this.buildCaseScopeQuery(actor, 2);
    const caseLock = await executor.query<QueryResultRow>(
      `SELECT c.id FROM cases c WHERE c.id = $1 AND c.deleted_at IS NULL
        ${caseScope.sql ? `AND ${caseScope.sql}` : ''} FOR UPDATE OF c`,
      [caseId, ...caseScope.params],
    );
    if (caseLock.rows.length === 0) return null;
    const result = await executor.query<QueryResultRow>(
      `
        SELECT referral.id, referral.status_code, c.status AS case_status,
          c.school_id, c.student_uuid::text, c.student_name,
          EXISTS (
            SELECT 1 FROM case_referral_results recorded
            WHERE recorded.case_referral_id = referral.id
          ) AS has_result,
          NOT EXISTS (
            SELECT 1 FROM case_referrals newer
            WHERE newer.case_id = referral.case_id
              AND (newer.referred_at, newer.id) > (referral.referred_at, referral.id)
          ) AS is_latest
        FROM case_referrals referral
        JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
        WHERE referral.id = $1 AND referral.case_id = $2${scopeSql}
        FOR UPDATE OF referral
      `,
      [referralId, caseId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  /** Recheck and lock the reporting link after the case/referral locks. */
  async lockReferralLinkForReport(linkId: string, referralId: string, executor: QueryExecutor) {
    const result = await executor.query<QueryResultRow>(
      `SELECT id, status_code, starts_at, expires_at, access_code_revision,
          starts_at <= clock_timestamp() AS has_started,
          expires_at > clock_timestamp() AS has_not_expired
       FROM case_referral_links
       WHERE id = $1 AND case_referral_id = $2
       FOR UPDATE`,
      [linkId, referralId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Writes the result, moves the referral to its outcome status and the case
   * out of รอผลการส่งต่อ back to รอพิจารณา in one go. The caller holds the
   * row locks.
   */
  async recordCaseReferralResult(
    data: {
      caseId: number;
      referralId: string;
      referralStatusCode: 'COMPLETED' | 'NOT_SUCCEEDED';
      nextCaseStatus: string;
      note: string;
      recordedByUserId: number | null;
      /** Set when the agency reported through its link. */
      agencyReport?: {
        linkId: string;
        actionDate: string;
        identityProviderCode: string;
        providerSubject: string;
        reporterName: string;
      };
    },
    executor: QueryExecutor,
  ): Promise<boolean> {
    const report = data.agencyReport ?? null;
    await executor.query(
      `
        INSERT INTO case_referral_results (
          case_referral_id, result_note, recorded_by_user_id, case_referral_link_id,
          action_date, reporter_identity_provider_code, reporter_provider_subject, reporter_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        data.referralId,
        data.note,
        data.recordedByUserId,
        report?.linkId ?? null,
        report?.actionDate ?? null,
        report?.identityProviderCode ?? null,
        report?.providerSubject ?? null,
        report?.reporterName ?? null,
      ],
    );
    // A referral takes one result: the link it came through is spent, and any
    // other link still open on it dies with it (the school recorded it first).
    await executor.query(
      `
        UPDATE case_referral_links
        SET status_code = CASE WHEN id = $2 THEN 'USED' ELSE 'REVOKED' END
        WHERE case_referral_id = $1 AND (status_code = 'ACTIVE' OR id = $2)
      `,
      [data.referralId, report?.linkId ?? null],
    );
    await executor.query(
      `
        UPDATE case_referrals
        SET status_code = $2, updated_by = $3
        WHERE id = $1
      `,
      [data.referralId, data.referralStatusCode, data.recordedByUserId],
    );
    const transitioned = await executor.query(
      `
        UPDATE cases
        SET status = $2, completion_outcome_code = NULL, updated_by = $3
        WHERE id = $1 AND status = 'AWAITING_REFERRAL_OUTCOME' AND deleted_at IS NULL
        RETURNING id
      `,
      [data.caseId, data.nextCaseStatus, data.recordedByUserId],
    );
    return transitioned.rows.length === 1;
  }

  async insertReferralLink(
    data: {
      referralId: string;
      tokenHash: string;
      tokenEncrypted: string;
      accessCodeHash: string;
      accessCodeEncrypted: string;
      startsAt: Date;
      expiresAt: Date;
      createdByUserId: number | null;
    },
    executor: QueryExecutor,
  ): Promise<string> {
    const result = await executor.query<{ id: string }>(
      `
        INSERT INTO case_referral_links (
          case_referral_id, token_hash, token_encrypted, access_code_hash, access_code_encrypted,
          starts_at, expires_at, created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        data.referralId,
        data.tokenHash,
        data.tokenEncrypted,
        data.accessCodeHash,
        data.accessCodeEncrypted,
        data.startsAt,
        data.expiresAt,
        data.createdByUserId,
      ],
    );
    return String(result.rows[0].id);
  }

  async lockLatestReferralAccessCode(referralId: string, executor: QueryExecutor) {
    const result = await executor.query<QueryResultRow>(
      `SELECT id, token_encrypted, access_code_hash, access_code_revision, status_code,
        expires_at > clock_timestamp() AS has_not_expired
       FROM case_referral_links WHERE case_referral_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [referralId],
    );
    return result.rows[0] ?? null;
  }

  async rotateReferralAccessCode(
    linkId: string,
    codeHash: string,
    codeEncrypted: string,
    executor: QueryExecutor,
  ): Promise<number> {
    const result = await executor.query<{ access_code_revision: number }>(
      `UPDATE case_referral_links SET access_code_hash = $2, access_code_encrypted = $3,
        access_code_revision = access_code_revision + 1, failed_code_attempts = 0
       WHERE id = $1 RETURNING access_code_revision`,
      [linkId, codeHash, codeEncrypted],
    );
    return Number(result.rows[0]?.access_code_revision);
  }

  async findReferralAccessCode(caseId: number, referralId: string, actor: ActorContext) {
    const scopeQuery = this.buildCaseScopeQuery(actor, 3);
    const result = await this.getExecutor().query(
      `SELECT link.access_code_encrypted
       FROM cases c
       JOIN case_referrals referral ON referral.case_id = c.id
       JOIN case_referral_links link ON link.case_referral_id = referral.id
       WHERE c.id = $1 AND referral.id = $2 AND c.deleted_at IS NULL
         ${scopeQuery.sql ? `AND ${scopeQuery.sql}` : ''}
       ORDER BY link.created_at DESC, link.id DESC LIMIT 1`,
      [caseId, referralId, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  /**
   * A referral link by its token hash, with what deciding whether it may be
   * used needs: its own state, and whether its referral is still the case's
   * open question. Never returns the token or the code hash's plaintext.
   */
  async findReferralLinkByTokenHash(tokenHash: string): Promise<QueryResultRow | null> {
    return await this.findReferralLink('link.token_hash = $1', tokenHash);
  }

  async findReferralLinkById(linkId: string): Promise<QueryResultRow | null> {
    return await this.findReferralLink('link.id = $1', linkId);
  }

  private async findReferralLink(whereSql: string, param: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
        SELECT link.id, link.case_referral_id, link.access_code_hash, link.access_code_revision, link.failed_code_attempts,
          link.status_code, link.starts_at, link.expires_at,
          referral.case_id, referral.referral_note, referral.referred_at,
          agency.agency_name, kind.label_th AS agency_kind_label,
          COALESCE(
            NULLIF(trim(concat_ws(' ', referrer."FirstName", referrer."LastName")), ''),
            referrer.username
          ) AS referred_by,
          c.status AS case_status, c.school_id,
          EXISTS (
            SELECT 1 FROM case_referral_results recorded
            WHERE recorded.case_referral_id = referral.id
          ) AS has_result
        FROM case_referral_links link
        JOIN case_referrals referral ON referral.id = link.case_referral_id
        JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
        JOIN referral_agencies agency ON agency.id = referral.referral_agency_id
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        LEFT JOIN users referrer ON referrer.id = referral.referred_by_user_id
        WHERE ${whereSql}
      `,
      [param],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Counts one wrong access code and locks the link on the last allowed try, in
   * one statement so two wrong guesses at once cannot both slip under the limit.
   */
  async recordFailedReferralLinkCode(
    linkId: string,
    maxAttempts: number,
  ): Promise<{ attempts: number; locked: boolean } | null> {
    const result = await this.query<{ failed_code_attempts: number; status_code: string }>(
      `
        UPDATE case_referral_links
        SET failed_code_attempts = failed_code_attempts + 1,
            status_code = CASE
              WHEN failed_code_attempts + 1 >= $2 THEN 'LOCKED' ELSE status_code
            END
        WHERE id = $1 AND status_code = 'ACTIVE'
        RETURNING failed_code_attempts, status_code
      `,
      [linkId, maxAttempts],
    );
    const row = result.rows[0];
    return row
      ? { attempts: Number(row.failed_code_attempts), locked: row.status_code === 'LOCKED' }
      : null;
  }

  /** Where the agency opens a referral link (same base as `/task/:token`). */
  referralLinkUrl(token: string): string {
    return `${this.appRuntimeConfig.frontendBaseUrl ?? ''}/referral-report/${token}`;
  }

  /** The shareable URL of a stored referral link, or null when it cannot be rebuilt. */
  resolveReferralLinkUrl(tokenEncrypted: string | null | undefined): string | null {
    if (!tokenEncrypted) return null;
    try {
      return this.referralLinkUrl(this.tokenEncryption.decrypt(tokenEncrypted));
    } catch {
      this.logger.warn('Unable to decrypt a stored referral link; returning it as unavailable');
      return null;
    }
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
              tl.assigned_to_name
          )
          ELSE tl.assigned_to_name
        END AS initial_assignee,
        tl.opens_at AS assignment_starts_at,
        tl.expires_at AS assignment_ends_at,
        tl.assignment_note,
        tl.status AS link_status,
        tl.token_encrypted AS link_token_encrypted,
        tl.assigned_teacher_id::text AS assigned_teacher_id,
        tl.line_delivery_teacher_id::text AS line_delivery_teacher_id,
        tl.line_delivery_status,
        tl.line_delivery_failure_code,
        tl.line_delivered_at,
        round_line_account.provider_user_id AS line_provider_user_id,
        round_line_account.friend_state AS line_friend_state,
        tl.cancelled_at,
        tl.cancel_reason,
        COALESCE(
          NULLIF(TRIM(cancelled_by_user."FirstName" || ' ' || cancelled_by_user."LastName"), ''),
          cancelled_by_user.username
        ) AS cancelled_by_label,
        (SELECT COUNT(*) FROM task_links WHERE task_id = t.id AND deleted_at IS NULL) AS link_count,
        latest_submission.submitted_at,
        latest_submission.visited_at,
        latest_submission.follow_up_problem_category_code,
        latest_submission.follow_up_problem_category_label,
        latest_submission.follow_up_problem_category_guidance,
        latest_submission.absence_reason_code,
        latest_submission.absence_reason_label,
        latest_submission.absence_reason_category_label,
        latest_submission.parental_status_code,
        latest_submission.parental_status_label,
        latest_submission.guardian_type_code,
        latest_submission.guardian_type_label,
        latest_submission.guardian_type_detail,
        latest_submission.contact_person_name,
        latest_submission.contact_channel_code,
        latest_submission.contact_channel_label,
        latest_submission.residence_environments,
        latest_submission.residence_environment_detail,
        latest_submission.observed_disadvantage_types,
        latest_submission.observed_disability_types,
        latest_submission.cause_detail,
        latest_submission.recommendation,
        latest_submission.visit_lat,
        latest_submission.visit_lng,
        latest_submission.photo_paths,
        latest_submission.address_changed,
        latest_submission.home_visit_exception_code,
        latest_submission.home_visit_exception_label,
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
        latest_submission.assistance_detail,
        latest_submission.task_execution_outcome_code,
        latest_submission.task_execution_outcome_label,
        latest_submission.execution_outcome_detail,
        latest_submission.non_follow_up_reason_code,
        latest_submission.non_follow_up_reason_label
      FROM tasks t
      LEFT JOIN task_links tl ON tl.task_id = t.id AND tl.deleted_at IS NULL
      LEFT JOIN users cancelled_by_user ON cancelled_by_user.id = tl.cancelled_by
      LEFT JOIN LATERAL (
        SELECT account.provider_user_id, account.friend_state
        FROM teacher_messaging_accounts account
        JOIN teachers account_teacher
          ON account_teacher.id = account.teacher_id
         AND account_teacher.teacher_status = 'ACTIVE'
         AND account_teacher.deleted_at IS NULL
        WHERE account.teacher_id = tl.assigned_teacher_id
          AND account.provider = 'LINE'
          AND account.unlinked_at IS NULL
          AND account.deleted_at IS NULL
        ORDER BY account.verified_at DESC, account.id DESC
        LIMIT 1
      ) round_line_account ON TRUE
      LEFT JOIN teachers current_assignee_teacher
        ON current_assignee_teacher.id = tl.assigned_teacher_id
       AND current_assignee_teacher.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT submission.submitted_at, submission.visited_at,
               submission.follow_up_problem_category_code,
               problem_category.label_th AS follow_up_problem_category_label,
               problem_category.guidance_th AS follow_up_problem_category_guidance,
               submission.absence_reason_code,
               absence_reason.label_th AS absence_reason_label,
               absence_category.label_th AS absence_reason_category_label,
               submission.parental_status_code,
               parental_status.label_th AS parental_status_label,
               submission.guardian_type_code,
               guardian_type.label_th AS guardian_type_label,
               submission.guardian_type_detail,
               submission.contact_person_name,
               submission.contact_channel_code,
               contact_channel.label_th AS contact_channel_label,
               ${RESIDENCE_ENVIRONMENTS_JSON_SQL} AS residence_environments,
               submission.residence_environment_detail,
               COALESCE((
                 SELECT json_agg(
                   json_build_object('code', option.code, 'label', option.label_th)
                   ORDER BY option.sort_order, option.code
                 )
                 FROM home_visit_disadvantage_observations observation
                 JOIN disadvantage_types option
                   ON option.code = observation.disadvantage_type_code
                 WHERE observation.task_submission_id = submission.id
               ), '[]'::json) AS observed_disadvantage_types,
               COALESCE((
                 SELECT json_agg(
                   json_build_object('code', option.code, 'label', option.label_th)
                   ORDER BY option.sort_order, option.code
                 )
                 FROM home_visit_disability_observations observation
                 JOIN disability_types option
                   ON option.code = observation.disability_type_code
                 WHERE observation.task_submission_id = submission.id
               ), '[]'::json) AS observed_disability_types,
               submission.cause_detail,
               submission.recommendation, submission.visit_lat, submission.visit_lng,
               submission.photo_paths, submission.address_changed,
               submission.home_visit_exception_code,
               home_visit_exception.label_th AS home_visit_exception_label,
               submission.updated_student_address, submission.updated_address_line,
               submission.updated_address_province, submission.updated_address_district,
               submission.updated_address_sub_district, submission.updated_postal_code,
               submission.updated_lat, submission.updated_lng,
               submission.case_follow_up_decision,
               submission.case_resolution_outcome_code,
               submission.assisted_at,
               submission.assistance_detail,
               submission.task_execution_outcome_code,
               CASE
                 WHEN t.task_type = 'VISIT'
                 THEN COALESCE(execution_outcome.visit_label_th, execution_outcome.label_th)
                 ELSE execution_outcome.label_th
               END AS task_execution_outcome_label,
               submission.execution_outcome_detail,
               submission.non_follow_up_reason_code,
               non_follow_up_reason.label_th AS non_follow_up_reason_label
        FROM task_links round_link
        JOIN task_submissions submission ON submission.task_link_id = round_link.id
        LEFT JOIN follow_up_problem_categories problem_category
          ON problem_category.code = submission.follow_up_problem_category_code
        LEFT JOIN absence_reasons absence_reason
          ON absence_reason.code = submission.absence_reason_code
        LEFT JOIN absence_reason_categories absence_category
          ON absence_category.code = COALESCE(
            submission.absence_reason_category_code,
            absence_reason.category_code
          )
        LEFT JOIN parental_status_options parental_status
          ON parental_status.code = submission.parental_status_code
          AND parental_status.deleted_at IS NULL
        LEFT JOIN guardian_type_options guardian_type
          ON guardian_type.code = submission.guardian_type_code
          AND guardian_type.deleted_at IS NULL
        LEFT JOIN task_execution_outcome_options execution_outcome
          ON execution_outcome.code = submission.task_execution_outcome_code
        LEFT JOIN non_follow_up_reason_options non_follow_up_reason
          ON non_follow_up_reason.code = submission.non_follow_up_reason_code
        LEFT JOIN contact_channel_options contact_channel
          ON contact_channel.code = submission.contact_channel_code
        LEFT JOIN home_visit_exception_options home_visit_exception
          ON home_visit_exception.code = submission.home_visit_exception_code
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

    // A round's link is shared again from the case page (its แชร์ button), so
    // only a link that still opens is returned — never a cancelled or used one.
    return result.rows.map(({ link_token_encrypted, ...row }) => ({
      ...row,
      magic_link:
        row.link_status === 'ACTIVE' || row.link_status === 'SCHEDULED'
          ? this.resolveMagicLink(link_token_encrypted as string | null)
          : null,
    }));
  }

  /**
   * The link of one assignment round of a case, with what a LINE send needs:
   * who it is assigned to, that teacher's verified LINE account, and the
   * wording's student/school/deadline. Only a link that still opens is found.
   */
  async findRoundLinkForLine(caseId: number, taskId: string): Promise<RoundLineLinkRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        tl.id,
        tl.task_id,
        tl.status,
        tl.expires_at,
        tl.line_delivery_request_id,
        tl.line_delivery_teacher_id::text AS line_delivery_teacher_id,
        tl.line_delivery_status,
        tl.line_delivery_failure_code,
        tl.token_encrypted,
        tl.assigned_teacher_id::text AS assigned_teacher_id,
        t.task_type,
        c.student_name,
        c.student_school,
        line_account.provider_user_id AS line_provider_user_id,
        line_account.friend_state AS line_friend_state
      FROM task_links tl
      JOIN tasks t ON t.id = tl.task_id AND t.deleted_at IS NULL
      JOIN cases c ON c.id = t.case_id
      LEFT JOIN teachers teacher
        ON teacher.id = tl.assigned_teacher_id
       AND teacher.teacher_status = 'ACTIVE'
       AND teacher.deleted_at IS NULL
      ${ROUND_LINE_ACCOUNT_JOIN_SQL}
      WHERE t.case_id = $1
        AND tl.task_id = $2::uuid
        AND tl.deleted_at IS NULL
        AND tl.status IN ('ACTIVE', 'SCHEDULED')
        AND tl.expires_at > clock_timestamp()
        AND COALESCE(tl.admin_locked, 0) <> 1
        AND c.deleted_at IS NULL
      ORDER BY tl.created_at DESC, tl.id DESC
      LIMIT 1
    `,
      [caseId, taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const { token_encrypted, ...rest } = row;
    return {
      ...(rest as Omit<RoundLineLinkRow, 'magic_link'>),
      magic_link: this.resolveMagicLink(token_encrypted as string | null),
    };
  }

  async recordRoundLineNotReady(
    linkId: string,
    teacherId: string | null,
    failureCode: RoundLineNotReadyCode,
    actorId: number | null,
    deliveryRequestId: string,
  ): Promise<void> {
    await this.query(
      `UPDATE task_links
       SET line_delivery_teacher_id = $2::bigint,
           line_delivery_status = 'NOT_READY',
           line_delivery_failure_code = $3,
           line_delivery_request_id = NULL,
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1::uuid AND status IN ('ACTIVE', 'SCHEDULED')
         AND assigned_teacher_id IS NOT DISTINCT FROM $2::bigint
         AND deleted_at IS NULL AND COALESCE(admin_locked, 0) <> 1
         AND expires_at > clock_timestamp()
         AND line_delivery_status <> 'SENDING'
         AND line_delivery_request_id IS DISTINCT FROM $5::uuid`,
      [linkId, teacherId, failureCode, actorId, deliveryRequestId],
    );
  }

  /**
   * Claims the send for one request id: a second press with the same id, or
   * any press while another send is still in flight (under five minutes),
   * claims nothing — so a double click never sends twice.
   */
  async claimRoundLine(
    linkId: string,
    teacherId: string,
    deliveryRequestId: string,
    actorId: number | null,
  ): Promise<RoundLineClaimResult> {
    const result = await this.query<{ id: string }>(
      `UPDATE task_links
       SET line_delivery_teacher_id = $2::bigint,
           line_delivery_status = 'SENDING',
           line_delivery_failure_code = NULL,
           line_delivery_attempt_count = line_delivery_attempt_count + 1,
           line_delivery_request_id = $3::uuid,
           line_delivery_last_attempted_at = now(),
           line_delivered_at = NULL,
           updated_by = $4
       WHERE id = $1::uuid
         AND status IN ('ACTIVE', 'SCHEDULED')
         AND deleted_at IS NULL AND COALESCE(admin_locked, 0) <> 1
         AND expires_at > clock_timestamp()
         AND EXISTS (SELECT 1 FROM tasks t JOIN cases c ON c.id = t.case_id
           WHERE t.id = task_links.task_id AND t.deleted_at IS NULL AND c.deleted_at IS NULL)
         AND assigned_teacher_id = $2::bigint
         AND (
           line_delivery_status <> 'SENDING'
           OR line_delivery_last_attempted_at < now() - interval '5 minutes'
         )
         AND line_delivery_request_id IS DISTINCT FROM $3::uuid
       RETURNING id`,
      [linkId, teacherId, deliveryRequestId, actorId],
    );
    if (result.rows.length > 0) return { kind: 'claimed' };
    // A rejected claim may be a completed transport retry, a concurrent send,
    // or a revoked/reassigned link. Never report all three as SENDING.
    const current = await this.query<{
      line_delivery_request_id: string | null;
      line_delivery_teacher_id: string | null;
      line_delivery_status: string;
      line_delivery_failure_code: string | null;
    }>(
      `SELECT line_delivery_request_id, line_delivery_teacher_id::text AS line_delivery_teacher_id,
         line_delivery_status, line_delivery_failure_code
       FROM task_links
       WHERE id = $1::uuid AND assigned_teacher_id = $2::bigint
         AND status IN ('ACTIVE', 'SCHEDULED')
         AND deleted_at IS NULL AND COALESCE(admin_locked, 0) <> 1
         AND expires_at > clock_timestamp()
         AND EXISTS (SELECT 1 FROM tasks t JOIN cases c ON c.id = t.case_id
           WHERE t.id = task_links.task_id AND t.deleted_at IS NULL AND c.deleted_at IS NULL)`,
      [linkId, teacherId],
    );
    const row = current.rows[0];
    if (!row) return { kind: 'unavailable' };
    if (
      row.line_delivery_request_id === deliveryRequestId &&
      row.line_delivery_teacher_id === teacherId &&
      (row.line_delivery_status === 'SENT' || row.line_delivery_status === 'FAILED')
    ) {
      return {
        kind: 'completed',
        status: row.line_delivery_status,
        failure_code: row.line_delivery_failure_code,
      };
    }
    return row.line_delivery_status === 'SENDING' ? { kind: 'in_flight' } : { kind: 'unavailable' };
  }

  /** Release only our own unsent claim when the post-claim snapshot is no longer usable. */
  async releaseRoundLineClaim(
    linkId: string,
    deliveryRequestId: string,
    failureCode: RoundLineNotReadyCode,
    actorId: number | null,
  ): Promise<void> {
    await this.query(
      `UPDATE task_links SET line_delivery_status = 'NOT_READY',
         line_delivery_failure_code = $3, line_delivery_request_id = NULL,
         line_delivered_at = NULL, updated_by = $4
       WHERE id = $1::uuid AND line_delivery_request_id = $2::uuid
         AND line_delivery_status = 'SENDING'`,
      [linkId, deliveryRequestId, failureCode, actorId],
    );
  }

  async finishRoundLine(
    linkId: string,
    deliveryRequestId: string,
    delivered: boolean,
    actorId: number | null,
  ): Promise<void> {
    await this.query(
      `UPDATE task_links
       SET line_delivery_status = CASE WHEN $3::boolean THEN 'SENT' ELSE 'FAILED' END,
           line_delivery_failure_code = CASE WHEN $3::boolean THEN NULL ELSE 'PROVIDER_UNAVAILABLE' END,
           line_delivered_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
           updated_by = $4
       WHERE id = $1::uuid
         AND line_delivery_request_id = $2::uuid
         AND line_delivery_status = 'SENDING'`,
      [linkId, deliveryRequestId, delivered, actorId],
    );
  }

  // Explicit safe column list (no created_by/updated_by/source actor ids) so a
  // new case_reviews column never leaks into the case response by accident.
  async listCaseReviews(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        review.id,
        review.case_id,
        review.review_action,
        review.review_note,
        review.review_summary,
        review.resolution_outcome,
        review.reviewed_by,
        review.reviewed_at,
        review.proposed_assistance_measure_detail,
        COALESCE((
          SELECT json_agg(
            json_build_object('code', measure.code, 'label', measure.label_th)
            ORDER BY measure.sort_order, measure.code
          )
          FROM case_review_assistance_measures proposed
          JOIN assistance_measure_options measure
            ON measure.code = proposed.assistance_measure_code
          WHERE proposed.case_review_id = review.id
        ), '[]'::json) AS proposed_assistance_measures,
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

  async listActiveReferralAgencies(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT agency.id, agency.agency_name, agency.agency_kind_code,
        kind.label_th AS agency_kind_label_th, agency.contact_phone,
        agency.contact_email, agency.website_url
      FROM referral_agencies agency
      JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
      WHERE agency.is_active = TRUE AND kind.is_active = TRUE
      ORDER BY kind.sort_order, agency.agency_name, agency.id
    `);
    return result.rows;
  }

  /**
   * The global school/area filter over `cases c`, appended after the actor's
   * scope (which it can only narrow). Pushes its values onto `params`.
   */
  private buildCaseAreaFilterSql(filters: FollowUpAreaFilters, params: unknown[]): string {
    const conditions: string[] = [];
    const areaColumns: Array<[string | undefined, string]> = [
      [filters.province, 'province'],
      [filters.district, 'district'],
      [filters.subDistrict, 'sub_district'],
    ];
    for (const [value, column] of areaColumns) {
      if (!value) continue;
      params.push(value);
      conditions.push(
        `EXISTS (SELECT 1 FROM schools area_school WHERE area_school.id = c.school_id AND area_school.${column} = $${params.length})`,
      );
    }
    if (filters.schoolId) {
      params.push(filters.schoolId);
      conditions.push(`c.school_id = $${params.length}`);
    }
    const enrollmentConditions = ['class_student.student_uuid = c.student_uuid'];
    for (const [column, value] of [
      ['class_grade.label', filters.grade],
      ['class_student."RoomID_Onec"::text', filters.room],
      ['class_student."AcademicYear_Onec"', filters.academicYear],
      ['class_student."Semester_Onec"', filters.semester],
    ] as const) {
      if (value !== undefined && value !== '') {
        params.push(value);
        enrollmentConditions.push(`${column} = $${params.length}`);
      }
    }
    if (enrollmentConditions.length > 1) {
      conditions.push(`EXISTS (
        SELECT 1 FROM student_term class_student
        LEFT JOIN grade_levels class_grade ON class_grade.id = class_student."GradeLevelID_Onec"
        WHERE ${enrollmentConditions.join(' AND ')}
      )`);
    }
    return conditions.map((condition) => ` AND ${condition}`).join('');
  }

  async getFollowUpOutcomeAggregate(
    actor: ActorContext,
    filters: FollowUpAreaFilters = {},
  ): Promise<QueryResultRow[]> {
    const scope = this.buildCaseScopeQuery(actor, 1);
    const params: unknown[] = [...scope.params];
    const scopeSql =
      (scope.sql ? ` AND ${scope.sql}` : '') + this.buildCaseAreaFilterSql(filters, params);
    const result = await this.query<QueryResultRow>(
      `
      SELECT task.task_type, submission.task_execution_outcome_code,
        COUNT(*)::int AS activity_count
      FROM task_submissions submission
      JOIN task_links link ON link.id = submission.task_link_id AND link.deleted_at IS NULL
      JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
      JOIN cases c ON c.id = task.case_id AND c.deleted_at IS NULL
      WHERE submission.deleted_at IS NULL
        AND task.task_type IN ('VISIT', 'ASSIST')${scopeSql}
      GROUP BY task.task_type, submission.task_execution_outcome_code
      ORDER BY task.task_type, submission.task_execution_outcome_code
      `,
      params,
    );
    return result.rows;
  }

  async getAssistanceMeasureAggregate(
    actor: ActorContext,
    filters: FollowUpAreaFilters = {},
  ): Promise<QueryResultRow[]> {
    const scope = this.buildCaseScopeQuery(actor, 1);
    const params: unknown[] = [...scope.params];
    const scopeSql =
      (scope.sql ? ` AND ${scope.sql}` : '') + this.buildCaseAreaFilterSql(filters, params);
    const result = await this.query<QueryResultRow>(
      `
      SELECT measure.code, measure.label_th,
        COUNT(*) FILTER (WHERE submission.task_execution_outcome_code = 'SUCCEEDED')::int
          AS succeeded_count,
        COUNT(*) FILTER (WHERE submission.task_execution_outcome_code = 'NOT_SUCCEEDED')::int
          AS not_succeeded_count,
        COUNT(*)::int AS total_count
      FROM task_submissions submission
      JOIN task_links link ON link.id = submission.task_link_id AND link.deleted_at IS NULL
      JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
      JOIN cases c ON c.id = task.case_id AND c.deleted_at IS NULL
      JOIN task_assistance_measures task_measure ON task_measure.task_id = task.id
      JOIN assistance_measure_options measure
        ON measure.code = task_measure.assistance_measure_code
      WHERE submission.deleted_at IS NULL
        AND task.task_type = 'ASSIST'${scopeSql}
      GROUP BY measure.code, measure.label_th, measure.sort_order
      ORDER BY measure.sort_order, measure.code
      `,
      params,
    );
    return result.rows;
  }

  async getReferralAggregate(
    actor: ActorContext,
    filters: FollowUpAreaFilters = {},
  ): Promise<QueryResultRow[]> {
    const scope = this.buildCaseScopeQuery(actor, 1);
    const params: unknown[] = [...scope.params];
    const scopeSql =
      (scope.sql ? ` AND ${scope.sql}` : '') + this.buildCaseAreaFilterSql(filters, params);
    const result = await this.query<QueryResultRow>(
      `
      SELECT referral.status_code, ${REFERRAL_STAGE_SQL} AS stage_code, agency.agency_name,
        COUNT(*)::int AS referral_count,
        COUNT(*) FILTER (
          WHERE referral.status_code IN ('REFERRED', 'ACCEPTED')
            AND latest_report_link.status_code IN ('ACTIVE', 'EXPIRED', 'LOCKED')
            AND latest_report_link.cancelled_at IS NULL
            AND latest_report_link.expires_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM case_referral_results recorded
              WHERE recorded.case_referral_id = referral.id
            )
        )::int AS overdue_count
      FROM ${REFERRAL_REGISTER_SOURCE_SQL}
      JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
      LEFT JOIN referral_agencies agency ON agency.id = referral.referral_agency_id
      LEFT JOIN LATERAL (
        SELECT link.status_code, link.expires_at, link.cancelled_at
        FROM case_referral_links link
        WHERE link.case_referral_id = referral.id
        ORDER BY link.created_at DESC, link.id DESC
        LIMIT 1
      ) latest_report_link ON true
      WHERE 1=1${scopeSql}
      GROUP BY referral.status_code, stage_code, agency.agency_name
      ORDER BY referral.status_code, stage_code, agency.agency_name
      `,
      params,
    );
    return result.rows;
  }

  async countRepeatedUnsuccessfulCases(
    actor: ActorContext,
    filters: FollowUpAreaFilters = {},
  ): Promise<number> {
    const scope = this.buildCaseScopeQuery(actor, 1);
    const params: unknown[] = [...scope.params];
    const scopeSql =
      (scope.sql ? ` AND ${scope.sql}` : '') + this.buildCaseAreaFilterSql(filters, params);
    const result = await this.query<CountRow>(
      `
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT c.id
        FROM task_submissions submission
        JOIN task_links link ON link.id = submission.task_link_id AND link.deleted_at IS NULL
        JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
        JOIN cases c ON c.id = task.case_id AND c.deleted_at IS NULL
        WHERE submission.deleted_at IS NULL
          AND submission.task_execution_outcome_code = 'NOT_SUCCEEDED'${scopeSql}
        GROUP BY c.id
        HAVING COUNT(*) >= 2
      ) repeated_cases
      `,
      params,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listReferralDrilldown(
    actor: ActorContext,
    filters: ReferralDrilldownFilters,
    page: number,
    limit: number,
  ): Promise<{ rows: QueryResultRow[]; totalCount: number }> {
    const offset = (page - 1) * limit;
    const scope = this.buildCaseScopeQuery(actor, 1);
    const filterParams: unknown[] = [...scope.params];
    let whereSql =
      (scope.sql ? ` AND ${scope.sql}` : '') + this.buildCaseAreaFilterSql(filters, filterParams);
    if (filters.statusCode) {
      filterParams.push(filters.statusCode);
      whereSql += ` AND referral.status_code = $${filterParams.length}`;
    }
    if (filters.stageCode) {
      filterParams.push(filters.stageCode);
      whereSql += ` AND (${REFERRAL_STAGE_SQL}) = $${filterParams.length}`;
    }
    if (filters.searchTerm) {
      filterParams.push(`%${escapeLikePattern(filters.searchTerm)}%`);
      whereSql += ` AND c.student_name ILIKE $${filterParams.length} ESCAPE '\\'`;
    }
    const fromSql = `
        FROM ${REFERRAL_REGISTER_SOURCE_SQL}
        JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
        WHERE 1=1${whereSql}`;
    const rowParams = [...filterParams, limit, offset];
    const [rows, count] = await Promise.all([
      this.query<QueryResultRow>(
        `
        SELECT referral.id, referral.case_id, c.student_uuid::text AS student_id,
          c.student_name, c.school_id,
          school.name AS school_name, grade.label AS grade,
          student."RoomID_Onec"::text AS room,
          student."AcademicYear_Onec" AS academic_year, student."Semester_Onec" AS semester,
          person.photo_storage_key, person.updated_at AS photo_updated_at,
          referral.status_code, referral.referred_at,
          ${REFERRAL_STAGE_SQL} AS stage_code,
          agency.agency_name, kind.label_th AS agency_kind_label,
          latest_link.status_code AS link_status_code, latest_link.expires_at AS link_expires_at,
          (latest_link.access_code_encrypted IS NOT NULL) AS access_code_available,
          latest_link.token_encrypted AS link_token_encrypted
        FROM ${REFERRAL_REGISTER_SOURCE_SQL}
        JOIN cases c ON c.id = referral.case_id AND c.deleted_at IS NULL
        LEFT JOIN schools school ON school.id = c.school_id
        LEFT JOIN student_term student ON student.student_uuid = c.student_uuid
        LEFT JOIN grade_levels grade ON grade.id = student."GradeLevelID_Onec"
        LEFT JOIN student_person person ON person.person_uuid = student.person_uuid
        LEFT JOIN referral_agencies agency ON agency.id = referral.referral_agency_id
        LEFT JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        LEFT JOIN LATERAL (
          SELECT link.status_code, link.expires_at, link.token_encrypted,
            link.access_code_encrypted
          FROM case_referral_links link
          WHERE link.case_referral_id = referral.id
          ORDER BY link.created_at DESC, link.id DESC
          LIMIT 1
        ) latest_link ON true
        WHERE 1=1${whereSql}
        ORDER BY referral.referred_at DESC, referral.id DESC
        LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}
        `,
        rowParams,
      ),
      this.query<CountRow>(`SELECT COUNT(*)::int AS count${fromSql}`, filterParams),
    ]);
    return {
      rows: rows.rows.map(({ link_token_encrypted, ...row }) => ({
        ...row,
        link_url:
          row.link_status_code === 'ACTIVE' && new Date(String(row.link_expires_at)) > new Date()
            ? this.resolveReferralLinkUrl(link_token_encrypted as string | null)
            : null,
      })),
      totalCount: Number(count.rows[0]?.count ?? 0),
    };
  }

  async listCaseReferrals(caseId: number): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `
        SELECT referral.id, referral.case_review_id, referral.referral_agency_id,
          agency.agency_name, agency.agency_kind_code,
          kind.label_th AS agency_kind_label_th, referral.status_code,
          status.label_th AS status_label_th, status.badge_variant AS status_badge_variant,
          referral.referred_at, referral.referral_note,
          COALESCE(
            NULLIF(trim(concat_ws(' ', actor."FirstName", actor."LastName")), ''),
            actor.username
          ) AS referred_by,
          result.result_note, result.recorded_at AS result_recorded_at,
          COALESCE(
            NULLIF(trim(concat_ws(' ', recorder."FirstName", recorder."LastName")), ''),
            recorder.username
          ) AS result_recorded_by,
          result.action_date AS result_action_date,
          result.case_referral_link_id IS NOT NULL AS result_reported_by_agency,
          result.reporter_name AS result_reporter_name,
          provider.label_th AS result_reporter_identity_provider,
          latest_link.id AS link_id, latest_link.status_code AS link_status_code,
          latest_link.starts_at AS link_starts_at, latest_link.expires_at AS link_expires_at,
          latest_link.token_encrypted AS link_token_encrypted,
          latest_link.cancelled_at AS link_cancelled_at, latest_link.cancel_reason AS link_cancel_reason,
          COALESCE(
            NULLIF(trim(concat_ws(' ', canceller."FirstName", canceller."LastName")), ''),
            canceller.username
          ) AS link_cancelled_by
        FROM case_referrals referral
        JOIN referral_agencies agency ON agency.id = referral.referral_agency_id
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        LEFT JOIN case_referral_statuses status ON status.code = referral.status_code
        LEFT JOIN users actor ON actor.id = referral.referred_by_user_id
        LEFT JOIN case_referral_results result ON result.case_referral_id = referral.id
        LEFT JOIN users recorder ON recorder.id = result.recorded_by_user_id
        LEFT JOIN identity_providers provider
          ON provider.code = result.reporter_identity_provider_code
        LEFT JOIN LATERAL (
          SELECT link.id, link.status_code, link.starts_at, link.expires_at, link.token_encrypted,
            link.cancelled_at, link.cancel_reason, link.cancelled_by_user_id
          FROM case_referral_links link
          WHERE link.case_referral_id = referral.id
          ORDER BY link.created_at DESC, link.id DESC
          LIMIT 1
        ) latest_link ON true
        LEFT JOIN users canceller ON canceller.id = latest_link.cancelled_by_user_id
        WHERE referral.case_id = $1
        ORDER BY referral.referred_at DESC, referral.id DESC
      `,
      [caseId],
    );
    // The token only leaves the database as the shareable URL of a link that
    // still opens; a spent, locked or revoked link has nothing to share.
    return result.rows.map(({ link_token_encrypted, ...row }) => ({
      ...row,
      link_url:
        row.link_status_code === 'ACTIVE' && new Date(String(row.link_expires_at)) > new Date()
          ? this.resolveReferralLinkUrl(link_token_encrypted as string | null)
          : null,
    }));
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

  /** School scope used by external identity verification for a task link. */
  async findTaskLinkAraIdIdentity(linkId: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT
        link.id AS link_id,
        -- The assignee, so identity verification can require it rather than
        -- accepting any teacher of the school.
        link.assigned_teacher_id,
        task.target_school_id
      FROM task_links link
      JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
      WHERE link.id = $1 AND link.deleted_at IS NULL
      LIMIT 1
    `,
      [linkId],
    );
    return result.rows[0] ?? null;
  }

  async findActiveTeacherInSchoolByEmail(
    email: string,
    schoolId: number,
  ): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT teacher.id::text AS teacher_id
       FROM teachers teacher
       JOIN school_teacher_memberships membership ON membership.teacher_id = teacher.id
       WHERE lower(btrim(teacher.email)) = lower(btrim($1))
         AND teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
         AND membership.school_id = $2
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
       LIMIT 1`,
      [email, schoolId],
    );
    return result.rows[0] ?? null;
  }

  async findActiveTeacherInSchoolByCitizenId(
    citizenId: string,
    schoolId: number,
  ): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT teacher.id::text AS teacher_id
       FROM teachers teacher
       JOIN school_teacher_memberships membership ON membership.teacher_id = teacher.id
       WHERE teacher.citizen_id = $1
         AND teacher.teacher_status = 'ACTIVE'
         AND teacher.deleted_at IS NULL
         AND membership.school_id = $2
         AND membership.membership_status = 'ACTIVE'
         AND membership.deleted_at IS NULL
       LIMIT 1`,
      [citizenId, schoolId],
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

  async listTaskExecutionOutcomes(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, visit_label_th FROM task_execution_outcome_options
      WHERE is_active = TRUE ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findTaskExecutionOutcome(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM task_execution_outcome_options
       WHERE code = $1 AND is_active = TRUE LIMIT 1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async listNonFollowUpReasons(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th FROM non_follow_up_reason_options
      WHERE is_active = TRUE ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async listAbsenceReasons(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT reason.code, reason.label_th, reason.category_code,
        category.label_th AS category_label_th
      FROM absence_reasons reason
      LEFT JOIN absence_reason_categories category ON category.code = reason.category_code
      WHERE reason.is_active = TRUE AND reason.code <> 'UNKNOWN'
      ORDER BY category.sort_order, reason.sort_order, reason.code
    `);
    return result.rows;
  }

  async findAbsenceReason(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th, category_code FROM absence_reasons
       WHERE code = $1 AND is_active = TRUE AND code <> 'UNKNOWN' LIMIT 1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findAbsenceReasonCategory(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM absence_reason_categories
       WHERE code = $1 AND is_active = TRUE LIMIT 1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async listContactChannelOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th FROM contact_channel_options
      WHERE is_active = TRUE
      ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findContactChannelOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM contact_channel_options
       WHERE code = $1 AND is_active = TRUE LIMIT 1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async findNonFollowUpReason(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM non_follow_up_reason_options
       WHERE code = $1 AND is_active = TRUE LIMIT 1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async listDisadvantageTypes(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th FROM disadvantage_types
      WHERE is_active = TRUE AND code <> 'NONE' ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findDisadvantageTypes(codes: string[]): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM disadvantage_types
       WHERE code = ANY($1::varchar[]) AND is_active = TRUE AND code <> 'NONE'`,
      [codes],
    );
    return result.rows;
  }

  async listDisabilityTypes(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th FROM disability_types
      WHERE is_active = TRUE AND code <> 'NONE' ORDER BY sort_order, code
    `);
    return result.rows;
  }

  async findDisabilityTypes(codes: string[]): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(
      `SELECT code, label_th FROM disability_types
       WHERE code = ANY($1::varchar[]) AND is_active = TRUE AND code <> 'NONE'`,
      [codes],
    );
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

  async listFollowUpProblemCategoryOptions(): Promise<QueryResultRow[]> {
    const result = await this.query<QueryResultRow>(`
      SELECT code, label_th, guidance_th
      FROM follow_up_problem_categories
      WHERE is_active = TRUE
      ORDER BY is_fallback, sort_order, code
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

  async findFollowUpProblemCategoryOption(code: string): Promise<QueryResultRow | null> {
    const result = await this.query<QueryResultRow>(
      `
      SELECT code, label_th, guidance_th
      FROM follow_up_problem_categories
      WHERE code = $1 AND is_active = TRUE
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
