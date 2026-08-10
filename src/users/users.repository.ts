import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PII_FIELD_GROUP_CODES } from '../students/pii-fields.config';
import { isUnconfiguredDataScope, normalizeScopeArray } from '../auth/auth.types';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { escapeLikePattern } from '../common/utils/helpers';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  AccountLifecycleStatus,
  DataScope,
  HydratableUserRow,
  QueryExecutor,
  QueryResultLike,
  RoleRow,
  StudentAccountCandidateRow,
  StudentAccountManagementRow,
} from './users.types';

interface CreateUserRecordInput {
  username: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  personIdOnec: string;
  personUuid?: string | null;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  lineId?: string | null;
  addressLine?: string | null;
  addressVillageNo?: string | null;
  addressStreet?: string | null;
  addressSoi?: string | null;
  addressTrok?: string | null;
  addressSubDistrict?: string | null;
  addressDistrict?: string | null;
  addressProvince?: string | null;
  addressPostalCode?: string | null;
  addressLatitude?: number | null;
  addressLongitude?: number | null;
  status: string;
  permissions: string[];
  role: string;
  dataScope: DataScope;
  mustChangePassword: boolean;
  temporaryPasswordIssuedAt?: Date | null;
  temporaryPasswordExpiresAt?: Date | null;
  createdBy: number | null;
}

interface UpdateUserRecordInput {
  id: number;
  username: string;
  passwordHash?: string;
  firstName: string;
  lastName: string;
  personIdOnec: string;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  lineId: string | null;
  addressLine: string | null;
  addressVillageNo: string | null;
  addressStreet: string | null;
  addressSoi: string | null;
  addressTrok: string | null;
  addressSubDistrict: string | null;
  addressDistrict: string | null;
  addressProvince: string | null;
  addressPostalCode: string | null;
  addressLatitude: number | null;
  addressLongitude: number | null;
  status: string;
  permissions: string[];
  role: string;
  dataScope: DataScope;
  updatedBy: number | null;
}

interface UpdateOwnProfileRecordInput {
  id: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  lineId: string | null;
  addressLine: string | null;
  addressVillageNo: string | null;
  addressStreet: string | null;
  addressSoi: string | null;
  addressTrok: string | null;
  addressSubDistrict: string | null;
  addressDistrict: string | null;
  addressProvince: string | null;
  addressPostalCode: string | null;
  addressLatitude: number | null;
  addressLongitude: number | null;
  updatedBy: number | null;
}

interface StudentOwnProfileContactRow extends Record<string, unknown> {
  person_uuid: string;
  has_canonical_contact: boolean;
  phone: string | null;
  email: string | null;
  line_id: string | null;
}

interface DeactivateUserInput {
  id: number;
  actorId: number | null;
  reasonCode: string | null;
  note: string | null;
}

interface UserReferenceColumnRow extends Record<string, unknown> {
  table_name: string;
  column_name: string;
}

interface UserReferenceExistsRow extends Record<string, unknown> {
  exists: boolean;
}

interface CreateRoleRecordInput {
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: string;
  scope_policy: string;
  school_id: number;
}

export interface UserListFilters {
  actorId: number;
  actorRole: string | null;
  actorRank: number;
  actorScope?: DataScope;
  excludeRole?: string;
  sortBy?: 'name' | 'role' | 'affiliation';
  sortOrder?: 'asc' | 'desc';
  searchTerm?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  gradeLevelId?: number;
  room?: string;
  accountStatus?: AccountLifecycleStatus;
  page?: number;
  limit?: number;
}

const USER_OPERATIONAL_REFERENCE_CHECKS = [
  { table: 'audit_log', column: 'actor_user_id' },
  { table: 'pii_access_events', column: 'actor_user_id' },
  { table: 'users', column: 'created_by' },
  { table: 'users', column: 'updated_by' },
  { table: 'users', column: 'deleted_by' },
  { table: 'users', column: 'deactivated_by' },
  { table: 'roles', column: 'created_by' },
  { table: 'roles', column: 'updated_by' },
  { table: 'cases', column: 'created_by' },
  { table: 'cases', column: 'updated_by' },
  { table: 'cases', column: 'deleted_by' },
  { table: 'tasks', column: 'created_by' },
  { table: 'tasks', column: 'updated_by' },
  { table: 'tasks', column: 'deleted_by' },
  { table: 'task_links', column: 'created_by' },
  { table: 'task_links', column: 'updated_by' },
  { table: 'task_links', column: 'deleted_by' },
  { table: 'task_submissions', column: 'created_by' },
  { table: 'task_submissions', column: 'updated_by' },
  { table: 'task_submissions', column: 'deleted_by' },
  { table: 'case_reviews', column: 'created_by' },
  { table: 'case_reviews', column: 'updated_by' },
  { table: 'attendance', column: 'created_by' },
  { table: 'attendance', column: 'updated_by' },
  { table: 'system_settings', column: 'created_by' },
  { table: 'system_settings', column: 'updated_by' },
  { table: 'schools', column: 'created_by' },
  { table: 'schools', column: 'updated_by' },
  { table: 'student_term', column: 'created_by' },
  { table: 'student_term', column: 'updated_by' },
  { table: 'student_term', column: 'deleted_by' },
  { table: 'student_exit_events', column: 'created_by' },
  { table: 'student_exit_events', column: 'updated_by' },
  { table: 'student_exit_events', column: 'deleted_by' },
  { table: 'risk_factors', column: 'created_by' },
  { table: 'risk_factors', column: 'updated_by' },
  { table: 'assistance_measures', column: 'created_by' },
  { table: 'assistance_measures', column: 'updated_by' },
  { table: 'educational_areas', column: 'created_by' },
  { table: 'educational_areas', column: 'updated_by' },
  { table: 'grade_levels', column: 'created_by' },
  { table: 'grade_levels', column: 'updated_by' },
  { table: 'schedules', column: 'created_by' },
  { table: 'schedules', column: 'updated_by' },
  { table: 'external_users', column: 'created_by' },
  { table: 'external_users', column: 'updated_by' },
  { table: 'school_terms', column: 'created_by' },
  { table: 'school_terms', column: 'updated_by' },
  { table: 'school_terms', column: 'deleted_by' },
  { table: 'school_calendar_days', column: 'created_by' },
  { table: 'school_calendar_days', column: 'updated_by' },
  { table: 'school_calendar_days', column: 'deleted_by' },
  { table: 'attendance_sessions', column: 'submitted_by' },
  { table: 'attendance_sessions', column: 'reopened_by' },
  { table: 'attendance_sessions', column: 'created_by' },
  { table: 'attendance_sessions', column: 'updated_by' },
  { table: 'attendance_sessions', column: 'deleted_by' },
] as const;

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

export interface StudentAccountManagementFilters {
  actorScope?: DataScope;
  userIds?: number[];
  searchTerm?: string;
  schoolId?: number;
  province?: string;
  district?: string;
  subDistrict?: string;
  grade?: string;
  room?: number;
  accountStatus?: AccountLifecycleStatus;
  onlyExpired?: boolean;
  page?: number;
  limit?: number;
}

export interface StudentAccountCandidateFilters {
  actorScope?: DataScope;
  studentIds?: string[];
  searchTerm?: string;
  schoolId?: number;
  province?: string;
  district?: string;
  subDistrict?: string;
  grade?: string;
  room?: number;
  onlyWithoutAccount?: boolean;
  /**
   * When set, excludes candidates that already have a batch-job item for this
   * job. Lets the async batch processor fetch the next unprocessed chunk with a
   * fixed page/limit even when some candidates were skipped/failed (they keep an
   * item row), so chunked resume always terminates.
   */
  excludeProcessedForJobId?: string;
  page?: number;
  limit?: number;
}

interface ScopeQuery {
  sql: string;
  params: unknown[];
}

interface CountRow extends Record<string, unknown> {
  count: number | string;
}

interface UserLifecycleStatusCountRow extends Record<string, unknown> {
  status: AccountLifecycleStatus;
  count: number | string;
}

interface StudentAccountStatusCountRow extends Record<string, unknown> {
  status: AccountLifecycleStatus;
  count: number | string;
}

@Injectable()
export class UsersRepository {
  private readonly userFieldsSql = `
    u.id,
    u.username,
    u."FirstName",
    u."LastName",
    u."PersonID_Onec",
    u.phone,
    u.email,
    u.affiliation,
    u.photo_storage_key,
    u.status,
    u.permissions,
    u.role,
    u.data_scope,
    u.must_change_password,
    u.temporary_password_issued_at,
    u.temporary_password_expires_at,
    u.deactivated_at,
    u.deactivated_by,
    u.deactivation_reason_code,
    u.deactivation_note,
    u.created_at,
    u.updated_at,
    CASE
      WHEN u.role IS NOT NULL THEN ARRAY[u.role]::text[]
      ELSE ARRAY[]::text[]
    END AS roles,
    CASE
      WHEN r.label IS NOT NULL THEN ARRAY[r.label]::text[]
      ELSE ARRAY[]::text[]
    END AS labels,
    r.default_permissions AS role_default_permissions
  `;

  private readonly userSelectSql = `
    SELECT
      ${this.userFieldsSql}
    FROM users u
    LEFT JOIN roles r ON r.name = u.role
  `;

  private readonly ownProfileSelectSql = `
    SELECT
      ${this.userFieldsSql},
      u.line_id,
      u.address_line,
      u.address_village_no,
      u.address_street,
      u.address_soi,
      u.address_trok,
      u.address_sub_district,
      u.address_district,
      u.address_province,
      u.address_postal_code,
      u.address_latitude,
      u.address_longitude
    FROM users u
    LEFT JOIN roles r ON r.name = u.role
  `;

  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
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
    const conditions: string[] = [`u.data_origin_code <> 'AUTOMATED_TEST'`];
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

  async listRoleRows(includeUsage = false, schoolId?: number | null): Promise<RoleRow[]> {
    const schoolCondition =
      schoolId === undefined
        ? ''
        : schoolId === null
          ? 'AND r.school_id IS NULL'
          : 'AND (r.school_id IS NULL OR r.school_id = $1)';
    const sql = includeUsage
      ? `
          SELECT
            r.id,
            r.name,
            r.label,
            r.rank,
            r.default_permissions,
            r.scope_mode,
            r.scope_policy,
            r.is_assignable,
            r.is_system,
            r.school_id,
            COALESCE(u.user_count, 0)::int AS user_count,
            COALESCE(tl.login_link_count, 0)::int AS login_link_count
          FROM roles r
          LEFT JOIN (
            SELECT role, COUNT(*) AS user_count
            FROM users
            GROUP BY role
          ) u ON u.role = r.name
          LEFT JOIN (
            SELECT tl.login_role, COUNT(*) AS login_link_count
            FROM task_links tl
            JOIN tasks t ON t.id = tl.task_id
            WHERE tl.login_role IS NOT NULL
              AND tl.deleted_at IS NULL
              AND t.deleted_at IS NULL
            GROUP BY tl.login_role
          ) tl ON tl.login_role = r.name
          WHERE r.is_assignable = TRUE
            ${schoolCondition}
          ORDER BY r.rank DESC, r.name ASC
        `
      : `
          SELECT
            r.id,
            r.name,
            r.label,
            r.rank,
            r.default_permissions,
            r.scope_mode,
            r.scope_policy,
            r.is_assignable,
            r.is_system,
            r.school_id
          FROM roles r
          WHERE r.is_assignable = TRUE
            ${schoolCondition}
          ORDER BY r.rank DESC, r.name ASC
        `;

    const result = await this.query<RoleRow>(sql, typeof schoolId === 'number' ? [schoolId] : []);
    return result.rows;
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
    const result = await this.query(
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

  async schoolRoleLabelExists(
    schoolId: number,
    label: string,
    excludeName?: string,
  ): Promise<boolean> {
    const params: unknown[] = [schoolId, label];
    const exclude = excludeName ? `AND name <> $${params.push(excludeName)}` : '';
    const result = await this.query(
      `
        SELECT 1
        FROM roles
        WHERE school_id = $1
          AND LOWER(BTRIM(label)) = LOWER(BTRIM($2))
          ${exclude}
        LIMIT 1
      `,
      params,
    );
    return result.rows.length > 0;
  }

  async listUsersPaginated(filters: UserListFilters): Promise<{
    rows: HydratableUserRow[];
    totalCount: number;
    lifecycleStatusCounts: Record<AccountLifecycleStatus, number>;
  }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    const roleRankSql = 'COALESCE(r.rank, 0)';
    const scopeSql = `COALESCE(u.data_scope::jsonb, '{}'::jsonb)`;

    params.push(filters.actorId);
    const actorIdPlaceholder = params.length;
    params.push(filters.actorRank);
    const actorRankPlaceholder = params.length;
    params.push(filters.actorRole);
    const actorRolePlaceholder = params.length;

    const manageConditions: string[] = [
      `
        (
          ${roleRankSql} < $${actorRankPlaceholder}
          OR ($${actorRolePlaceholder} = 'ADMIN' AND ${roleRankSql} = $${actorRankPlaceholder})
        )
      `,
    ];
    const scopeQuery = this.buildJsonScopeSubsetQuery(
      scopeSql,
      filters.actorScope,
      params.length + 1,
    );
    if (scopeQuery.sql) {
      manageConditions.push(scopeQuery.sql);
      params.push(...scopeQuery.params);
    }

    conditions.push(`
      (
        u.id = $${actorIdPlaceholder}
        OR (${manageConditions.join(' AND ')})
      )
    `);

    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`
        (
          CONCAT_WS(' ', u."FirstName", u."LastName") ILIKE $${params.length}
          OR u.username ILIKE $${params.length}
        )
      `);
    }
    if (filters.excludeRole) {
      // Comma-separated so one page can exclude several roles at once — the staff
      // list hides both TEACHER (own page) and STUDENT (retired).
      const excludedRoles = filters.excludeRole
        .split(',')
        .map((role) => role.trim())
        .filter((role) => role.length > 0);
      if (excludedRoles.length > 0) {
        params.push(excludedRoles);
        conditions.push(`(u.role IS NULL OR NOT (u.role = ANY($${params.length}::text[])))`);
      }
    }

    const addDataScopeFilter = (
      jsonKey: keyof Omit<DataScope, 'own_only'>,
      value: string,
    ): void => {
      params.push(value);
      conditions.push(`
        jsonb_typeof(${scopeSql} -> '${jsonKey}') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeSql} -> '${jsonKey}') AS filter_scope(value)
          WHERE filter_scope.value = $${params.length}
        )
      `);
    };

    if (filters.province) {
      addDataScopeFilter('provinces', filters.province);
    }
    if (filters.district) {
      addDataScopeFilter('districts', filters.district);
    }
    if (filters.subDistrict) {
      addDataScopeFilter('sub_districts', filters.subDistrict);
    }
    if (filters.schoolId) {
      addDataScopeFilter('school_ids', String(filters.schoolId));
    }
    if (filters.gradeLevelId) {
      addDataScopeFilter('grade_levels', String(filters.gradeLevelId));
    }
    if (filters.room) {
      addDataScopeFilter('room_ids', filters.room);
    }

    const lifecycleStatusSql = `
      CASE
        WHEN u.status <> 'ACTIVE' THEN 'DISABLED'
        WHEN u.must_change_password IS TRUE
          AND u.temporary_password_expires_at IS NOT NULL
          AND u.temporary_password_expires_at <= NOW()
          THEN 'TEMP_PASSWORD_EXPIRED'
        WHEN u.must_change_password IS TRUE THEN 'PENDING_FIRST_LOGIN'
        ELSE 'ACTIVE'
      END
    `;
    const lifecycleWhereSql = `WHERE ${conditions.join(' AND ')}`;
    const lifecycleParams = [...params];
    if (filters.accountStatus) {
      params.push(filters.accountStatus);
      conditions.push(`(${lifecycleStatusSql}) = $${params.length}`);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const countResult = await this.query<CountRow>(
      `
        SELECT COUNT(*)::int AS count
        FROM users u
        LEFT JOIN roles r ON r.name = u.role
        ${whereSql}
      `,
      params,
    );
    const totalCount = Number.parseInt(String(countResult.rows[0]?.count || '0'), 10);
    const lifecycleCountsResult = await this.query<UserLifecycleStatusCountRow>(
      `
        SELECT lifecycle_status AS status, COUNT(*)::int AS count
        FROM (
          SELECT
            ${lifecycleStatusSql} AS lifecycle_status
          FROM users u
          LEFT JOIN roles r ON r.name = u.role
          ${lifecycleWhereSql}
        ) scoped_users
        GROUP BY lifecycle_status
      `,
      lifecycleParams,
    );
    const lifecycleStatusCounts = lifecycleCountsResult.rows.reduce(
      (counts, row) => ({
        ...counts,
        [row.status]: Number.parseInt(String(row.count || '0'), 10),
      }),
      {
        PENDING_FIRST_LOGIN: 0,
        ACTIVE: 0,
        TEMP_PASSWORD_EXPIRED: 0,
        DISABLED: 0,
      },
    );

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;
    const selectParams = [...params, limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;
    const userSortExpressions = {
      name: `COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u."FirstName", u."LastName")), ''), u.username)`,
      role: `COALESCE(r.label, u.role, '')`,
      affiliation: `COALESCE(u.affiliation, '')`,
    };
    const sortExpression = filters.sortBy ? userSortExpressions[filters.sortBy] : 'u.created_at';
    const sortOrder = filters.sortBy ? (filters.sortOrder === 'desc' ? 'DESC' : 'ASC') : 'DESC';

    const result = await this.query<HydratableUserRow>(
      `
        ${this.userSelectSql}
        ${whereSql}
        ORDER BY ${sortExpression} ${sortOrder}, u.id ${sortOrder}
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    );

    return { rows: result.rows, totalCount, lifecycleStatusCounts };
  }

  async findUserById(id: number): Promise<HydratableUserRow | null> {
    const result = await this.query<HydratableUserRow>(
      `
        ${this.ownProfileSelectSql}
        WHERE u.id = $1
      `,
      [id],
    );

    return result.rows[0] || null;
  }

  async updateUserPhoto(id: number, storageKey: string | null): Promise<void> {
    await this.query(`UPDATE users SET photo_storage_key = $2 WHERE id = $1`, [id, storageKey]);
  }

  async findOwnProfileById(id: number): Promise<HydratableUserRow | null> {
    const result = await this.query<HydratableUserRow>(
      `
        ${this.ownProfileSelectSql}
        WHERE u.id = $1
      `,
      [id],
    );

    return result.rows[0] || null;
  }

  /** Resolve a student account's identifier from its canonical person when the user mirror is blank. */
  async findResolvedNationalIdByUserId(id: number): Promise<string | null> {
    const result = await this.query<{ person_id: string | null }>(
      `
        SELECT COALESCE(
          NULLIF(btrim(u."PersonID_Onec"), ''),
          enrollment."PersonID_Onec"
        ) AS person_id
        FROM users u
        LEFT JOIN LATERAL (
          SELECT s."PersonID_Onec"
          FROM student_term s
          WHERE s.person_uuid = u.person_uuid
          ORDER BY s."AcademicYear_Onec" DESC NULLS LAST,
            s."Semester_Onec" DESC NULLS LAST,
            s.created_at DESC NULLS LAST
          LIMIT 1
        ) enrollment ON true
        WHERE u.id = $1
      `,
      [id],
    );
    return result.rows[0]?.person_id ?? null;
  }

  async findStudentPersonContactByUserId(
    id: number,
    executor?: QueryExecutor,
  ): Promise<StudentOwnProfileContactRow | null> {
    const result = await this.getExecutor(executor).query<StudentOwnProfileContactRow>(
      `
        SELECT u.person_uuid,
               (contact.person_uuid IS NOT NULL) AS has_canonical_contact,
               contact.phone,
               contact.email,
               contact.line_id
        FROM users u
        LEFT JOIN student_person_contact contact ON contact.person_uuid = u.person_uuid
        WHERE u.id = $1
          AND u.role = 'STUDENT'
          AND u.person_uuid IS NOT NULL
      `,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async upsertStudentPersonContact(
    data: {
      personUuid: string;
      phone: string | null;
      email: string | null;
      lineId: string | null;
      updatedBy: number | null;
    },
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.getExecutor(executor).query(
      `
        INSERT INTO student_person_contact (
          person_uuid, phone, email, line_id, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (person_uuid) DO UPDATE
        SET phone = EXCLUDED.phone,
            email = EXCLUDED.email,
            line_id = EXCLUDED.line_id,
            updated_by = EXCLUDED.updated_by,
            deleted_at = NULL,
            deleted_by = NULL
      `,
      [data.personUuid, data.phone, data.email, data.lineId, data.updatedBy],
    );
  }

  async insertUserAddressAccessEvent(input: {
    actorUserId: number;
    actorRoles: string[];
    subjectRef: string;
    subjectRefKeyVersion: number;
    reasonCode: string;
    reasonNote: string | null;
    requestId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.query(
      `
        INSERT INTO pii_access_events (
          actor_user_id, actor_roles, actor_kind, subject_student_ref,
          subject_type, subject_ref, subject_ref_key_version, field_group,
          reason_code, reason_note, request_id, ip, user_agent
        )
        VALUES ($1, $2::jsonb, 'STAFF', $3, 'USER', $3, $4, 'ADDRESS', $5, $6, $7, $8, $9)
      `,
      [
        input.actorUserId,
        JSON.stringify(input.actorRoles),
        input.subjectRef,
        input.subjectRefKeyVersion,
        input.reasonCode,
        input.reasonNote,
        input.requestId,
        input.ip,
        input.userAgent,
      ],
    );
  }

  async hasActiveUserAddressReveal(
    actorUserId: number,
    subjectRef: string,
    withinSeconds: number,
  ): Promise<boolean> {
    const result = await this.query<{ found: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM pii_access_events
          WHERE actor_user_id = $1
            AND subject_type = 'USER'
            AND subject_ref = $2
            AND field_group = 'ADDRESS'
            AND created_at > now() - make_interval(secs => $3)
        ) AS found
      `,
      [actorUserId, subjectRef, withinSeconds],
    );
    return result.rows[0]?.found === true;
  }

  async insertUserNationalIdAccessEvent(input: {
    actorUserId: number;
    actorRoles: string[];
    subjectRef: string;
    subjectRefKeyVersion: number;
    reasonCode: string;
    reasonNote: string | null;
    requestId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.query(
      `
        INSERT INTO pii_access_events (
          actor_user_id, actor_roles, actor_kind, subject_student_ref,
          subject_type, subject_ref, subject_ref_key_version, field_group,
          reason_code, reason_note, request_id, ip, user_agent
        )
        VALUES ($1, $2::jsonb, 'STAFF', $3, 'USER', $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        input.actorUserId,
        JSON.stringify(input.actorRoles),
        input.subjectRef,
        input.subjectRefKeyVersion,
        PII_FIELD_GROUP_CODES.NATIONAL_ID,
        input.reasonCode,
        input.reasonNote,
        input.requestId,
        input.ip,
        input.userAgent,
      ],
    );
  }

  async hasActiveUserNationalIdReveal(
    actorUserId: number,
    subjectRef: string,
    withinSeconds: number,
  ): Promise<boolean> {
    const result = await this.query<{ found: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM pii_access_events
          WHERE actor_user_id = $1
            AND subject_type = 'USER'
            AND subject_ref = $2
            AND field_group = $3
            AND created_at > now() - make_interval(secs => $4)
        ) AS found
      `,
      [actorUserId, subjectRef, PII_FIELD_GROUP_CODES.NATIONAL_ID, withinSeconds],
    );
    return result.rows[0]?.found === true;
  }

  async findSchoolNamesByIds(
    ids: number[],
    executor?: QueryExecutor,
  ): Promise<Array<{ id: number; name: string | null }>> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.getExecutor(executor).query<{ id: number; name: string | null }>(
      `
        SELECT id, name
        FROM schools
        WHERE id = ANY($1::int[])
        ORDER BY name ASC, id ASC
      `,
      [ids],
    );
    return result.rows;
  }

  async findGradeLevelLabelsByIds(
    ids: number[],
    executor?: QueryExecutor,
  ): Promise<Array<{ id: number; label: string }>> {
    if (ids.length === 0) {
      return [];
    }
    const result = await this.getExecutor(executor).query<{ id: number; label: string }>(
      `
        SELECT id, label
        FROM grade_levels
        WHERE id = ANY($1::int[])
        ORDER BY id ASC
      `,
      [ids],
    );
    return result.rows;
  }

  async createUser(data: CreateUserRecordInput, executor?: QueryExecutor): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<{ id: number }>(
      `
        INSERT INTO users (
          username,
          password,
          "FirstName",
          "LastName",
          "PersonID_Onec",
          phone,
          email,
          affiliation,
          line_id,
          address_line,
          address_village_no,
          address_street,
          address_soi,
          address_trok,
          address_sub_district,
          address_district,
          address_province,
          address_postal_code,
          address_latitude,
          address_longitude,
          status,
          permissions,
          role,
          data_scope,
          person_uuid,
          must_change_password,
          temporary_password_issued_at,
          temporary_password_expires_at,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $29)
        RETURNING id
      `,
      [
        data.username,
        data.passwordHash,
        data.firstName,
        data.lastName,
        data.personIdOnec,
        data.phone,
        data.email,
        data.affiliation,
        data.lineId,
        data.addressLine,
        data.addressVillageNo,
        data.addressStreet,
        data.addressSoi,
        data.addressTrok,
        data.addressSubDistrict,
        data.addressDistrict,
        data.addressProvince,
        data.addressPostalCode,
        data.addressLatitude,
        data.addressLongitude,
        data.status,
        JSON.stringify(data.permissions),
        data.role,
        JSON.stringify(data.dataScope),
        data.personUuid ?? null,
        data.mustChangePassword,
        data.temporaryPasswordIssuedAt ?? null,
        data.temporaryPasswordExpiresAt ?? null,
        data.createdBy,
      ],
    );

    return result.rows[0].id;
  }

  async reconcileTeacherMemberships(
    input: {
      teacherUserId: number;
      schoolIds: number[];
      actorUserId: number | null;
    },
    executor: QueryExecutor,
  ): Promise<{ activatedSchoolIds: number[]; endedSchoolIds: number[] }> {
    const result = await executor.query<{
      activated_school_ids: number[] | null;
      ended_school_ids: number[] | null;
    }>(
      `
        WITH ended AS (
          UPDATE school_teacher_memberships
          SET membership_status = 'INACTIVE',
              ended_on = COALESCE(ended_on, CURRENT_DATE),
              updated_by = $3
          WHERE teacher_user_id = $1
            AND membership_status = 'ACTIVE'
            AND deleted_at IS NULL
            AND NOT (school_id = ANY($2::int[]))
          RETURNING school_id
        ), activated AS (
          INSERT INTO school_teacher_memberships (
            school_id, teacher_user_id, membership_status, started_on, created_by, updated_by
          )
          SELECT school_id, $1, 'ACTIVE', CURRENT_DATE, $3, $3
          FROM unnest($2::int[]) AS requested(school_id)
          WHERE NOT EXISTS (
            SELECT 1
            FROM school_teacher_memberships membership
            WHERE membership.school_id = requested.school_id
              AND membership.teacher_user_id = $1
              AND membership.membership_status = 'ACTIVE'
              AND membership.deleted_at IS NULL
          )
          ON CONFLICT DO NOTHING
          RETURNING school_id
        )
        SELECT
          (SELECT array_agg(school_id ORDER BY school_id) FROM activated) AS activated_school_ids,
          (SELECT array_agg(school_id ORDER BY school_id) FROM ended) AS ended_school_ids
      `,
      [input.teacherUserId, input.schoolIds, input.actorUserId],
    );
    return {
      activatedSchoolIds: result.rows[0]?.activated_school_ids ?? [],
      endedSchoolIds: result.rows[0]?.ended_school_ids ?? [],
    };
  }

  private buildStudentAccountCandidateQuery(filters: StudentAccountCandidateFilters): {
    whereSql: string;
    params: unknown[];
  } {
    const params: unknown[] = [];
    const conditions = [
      's.deleted_at IS NULL',
      's.person_uuid IS NOT NULL',
      `s."SchoolID_Onec" IS NOT NULL`,
    ];

    if (filters.actorScope) {
      const scopeResult = buildDataScopeQuery(
        filters.actorScope,
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
        scopeResult.params.forEach((param) => params.push(param));
      }
    }

    if (filters.studentIds && filters.studentIds.length > 0) {
      params.push(filters.studentIds);
      conditions.push(`s.student_uuid = ANY($${params.length}::uuid[])`);
    }
    if (filters.searchTerm) {
      params.push(`%${escapeLikePattern(filters.searchTerm)}%`);
      conditions.push(
        `CONCAT_WS(' ', s."FirstName_Onec", s."MiddleName_Onec", s."LastName_Onec") ILIKE $${params.length} ESCAPE '\\'`,
      );
    }

    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
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
    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`gl.label = $${params.length}`);
    }
    if (typeof filters.room === 'number') {
      params.push(filters.room);
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }
    if (filters.onlyWithoutAccount !== false) {
      conditions.push('existing_user.id IS NULL');
    }
    if (filters.excludeProcessedForJobId) {
      params.push(filters.excludeProcessedForJobId);
      conditions.push(
        `NOT EXISTS (
          SELECT 1 FROM student_account_batch_job_item i
          WHERE i.job_id = $${params.length}::uuid AND i.person_uuid = s.person_uuid
        )`,
      );
    }

    return {
      whereSql: `WHERE ${conditions.join(' AND ')}`,
      params,
    };
  }

  async listStudentAccountCandidates(
    filters: StudentAccountCandidateFilters,
    executor?: QueryExecutor,
  ): Promise<StudentAccountCandidateRow[]> {
    const queryExecutor = this.getExecutor(executor);
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);
    const { whereSql, params } = this.buildStudentAccountCandidateQuery(filters);
    const selectParams = [...params, limit, (page - 1) * limit];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;
    const result = await queryExecutor.query<StudentAccountCandidateRow>(
      `
        SELECT
          s.student_uuid::text,
          s.person_uuid::text,
          s."FirstName_Onec" AS first_name,
          s."LastName_Onec" AS last_name,
          s."SchoolID_Onec" AS school_id,
          sc.name AS school_name,
          gl.label AS grade_label,
          s."GradeLevelID_Onec" AS grade_level_id,
          s."RoomID_Onec" AS room_id,
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester,
          existing_user.id AS existing_user_id,
          existing_user.username AS existing_username
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN users existing_user
          ON existing_user.person_uuid = s.person_uuid
         AND existing_user.role = 'STUDENT'
         AND existing_user.status = 'ACTIVE'
        ${whereSql}
        ORDER BY s."SchoolID_Onec", s."GradeLevelID_Onec", s."RoomID_Onec", s."PersonID_Onec"
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    );
    return result.rows;
  }

  async countStudentAccountCandidates(
    filters: StudentAccountCandidateFilters,
  ): Promise<{ totalCount: number; withoutAccountCount: number; existingAccountCount: number }> {
    const baseFilters = { ...filters, onlyWithoutAccount: false };
    const { whereSql, params } = this.buildStudentAccountCandidateQuery(baseFilters);
    const result = await this.query<{
      total_count: number | string;
      without_account_count: number | string;
      existing_account_count: number | string;
    }>(
      `
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE existing_user.id IS NULL)::int AS without_account_count,
          COUNT(*) FILTER (WHERE existing_user.id IS NOT NULL)::int AS existing_account_count
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN users existing_user
          ON existing_user.person_uuid = s.person_uuid
         AND existing_user.role = 'STUDENT'
         AND existing_user.status = 'ACTIVE'
        ${whereSql}
      `,
      params,
    );
    return {
      totalCount: Number(result.rows[0]?.total_count ?? 0),
      withoutAccountCount: Number(result.rows[0]?.without_account_count ?? 0),
      existingAccountCount: Number(result.rows[0]?.existing_account_count ?? 0),
    };
  }

  private buildStudentAccountManagementQuery(filters: StudentAccountManagementFilters): {
    whereSql: string;
    params: unknown[];
  } {
    const params: unknown[] = [];
    const conditions = [
      `u.role = 'STUDENT'`,
      'u.person_uuid IS NOT NULL',
      's.deleted_at IS NULL',
      's.person_uuid IS NOT NULL',
      `s."SchoolID_Onec" IS NOT NULL`,
    ];

    if (filters.actorScope) {
      const scopeResult = buildDataScopeQuery(
        filters.actorScope,
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
        scopeResult.params.forEach((param) => params.push(param));
      }
    }

    if (filters.userIds && filters.userIds.length > 0) {
      params.push(filters.userIds);
      conditions.push(`u.id = ANY($${params.length}::int[])`);
    }
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`
        (
          CONCAT_WS(' ', u."FirstName", u."LastName") ILIKE $${params.length}
          OR CONCAT_WS(' ', s."FirstName_Onec", s."LastName_Onec") ILIKE $${params.length}
          OR u.username ILIKE $${params.length}
        )
      `);
    }
    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
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
    if (filters.grade) {
      params.push(filters.grade);
      conditions.push(`gl.label = $${params.length}`);
    }
    if (typeof filters.room === 'number') {
      params.push(filters.room);
      conditions.push(`s."RoomID_Onec" = $${params.length}`);
    }

    const expiredCondition = `
      u.status = 'ACTIVE'
      AND u.must_change_password IS TRUE
      AND u.temporary_password_expires_at IS NOT NULL
      AND u.temporary_password_expires_at <= NOW()
    `;
    if (filters.onlyExpired === true || filters.accountStatus === 'TEMP_PASSWORD_EXPIRED') {
      conditions.push(`(${expiredCondition})`);
    } else if (filters.accountStatus === 'PENDING_FIRST_LOGIN') {
      conditions.push(`
        u.status = 'ACTIVE'
        AND u.must_change_password IS TRUE
        AND (
          u.temporary_password_expires_at IS NULL
          OR u.temporary_password_expires_at > NOW()
        )
      `);
    } else if (filters.accountStatus === 'ACTIVE') {
      conditions.push(`u.status = 'ACTIVE' AND COALESCE(u.must_change_password, FALSE) = FALSE`);
    } else if (filters.accountStatus === 'DISABLED') {
      conditions.push(`u.status <> 'ACTIVE'`);
    }

    return {
      whereSql: `WHERE ${conditions.join(' AND ')}`,
      params,
    };
  }

  async listStudentAccountsPaginated(
    filters: StudentAccountManagementFilters,
  ): Promise<{ rows: StudentAccountManagementRow[]; totalCount: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);
    const { whereSql, params } = this.buildStudentAccountManagementQuery(filters);
    const countResult = await this.query<CountRow>(
      `
        SELECT COUNT(DISTINCT u.id)::int AS count
        FROM users u
        JOIN student_term s ON s.person_uuid = u.person_uuid
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        ${whereSql}
      `,
      params,
    );
    const totalCount = Number.parseInt(String(countResult.rows[0]?.count || '0'), 10);
    const selectParams = [...params, limit, (page - 1) * limit];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;
    const result = await this.query<StudentAccountManagementRow>(
      `
        SELECT DISTINCT ON (u.id)
          u.id AS user_id,
          u.username,
          u.status,
          u.must_change_password,
          u.temporary_password_issued_at,
          u.temporary_password_expires_at,
          u.deactivated_at,
          u.deactivated_by,
          u.deactivation_reason_code,
          u.deactivation_note,
          u.created_at,
          u.person_uuid::text,
          s.student_uuid::text,
          COALESCE(s."FirstName_Onec", u."FirstName") AS first_name,
          COALESCE(s."LastName_Onec", u."LastName") AS last_name,
          s."SchoolID_Onec" AS school_id,
          sc.name AS school_name,
          gl.label AS grade_label,
          s."GradeLevelID_Onec" AS grade_level_id,
          s."RoomID_Onec" AS room_id,
          s."AcademicYear_Onec" AS academic_year,
          s."Semester_Onec" AS semester
        FROM users u
        JOIN student_term s ON s.person_uuid = u.person_uuid
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        ${whereSql}
        ORDER BY u.id, s."AcademicYear_Onec" DESC NULLS LAST, s."Semester_Onec" DESC NULLS LAST
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    );
    return { rows: result.rows, totalCount };
  }

  async countStudentAccountStatuses(
    filters: StudentAccountManagementFilters,
  ): Promise<Record<AccountLifecycleStatus, number>> {
    const statusFilters = {
      ...filters,
      accountStatus: undefined,
      onlyExpired: undefined,
      page: undefined,
      limit: undefined,
    };
    const { whereSql, params } = this.buildStudentAccountManagementQuery(statusFilters);
    const result = await this.query<StudentAccountStatusCountRow>(
      `
        SELECT status, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT ON (u.id)
            CASE
              WHEN u.status <> 'ACTIVE' THEN 'DISABLED'
              WHEN u.must_change_password IS TRUE
                AND u.temporary_password_expires_at IS NOT NULL
                AND u.temporary_password_expires_at <= NOW()
                THEN 'TEMP_PASSWORD_EXPIRED'
              WHEN u.must_change_password IS TRUE THEN 'PENDING_FIRST_LOGIN'
              ELSE 'ACTIVE'
            END AS status
          FROM users u
          JOIN student_term s ON s.person_uuid = u.person_uuid
          JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = s.person_uuid
           AND current_enrollment.selected_student_uuid = s.student_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          JOIN schools sc ON sc.id = s."SchoolID_Onec"
          LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
          ${whereSql}
          ORDER BY u.id, s."AcademicYear_Onec" DESC NULLS LAST, s."Semester_Onec" DESC NULLS LAST
        ) scoped_accounts
        GROUP BY status
      `,
      params,
    );
    return result.rows.reduce(
      (counts, row) => ({
        ...counts,
        [row.status]: Number.parseInt(String(row.count || '0'), 10),
      }),
      {
        PENDING_FIRST_LOGIN: 0,
        ACTIVE: 0,
        TEMP_PASSWORD_EXPIRED: 0,
        DISABLED: 0,
      },
    );
  }

  async findStudentAccountForManagement(
    userId: number,
    actorScope?: DataScope,
  ): Promise<StudentAccountManagementRow | null> {
    const { rows } = await this.listStudentAccountsPaginated({
      actorScope,
      userIds: [userId],
      page: 1,
      limit: 1,
    });
    return rows[0] || null;
  }

  async deactivateUser(data: DeactivateUserInput, executor?: QueryExecutor): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query(
      `
        UPDATE users
        SET status = 'DISABLED',
            deactivated_at = NOW(),
            deactivated_by = $2,
            deactivation_reason_code = $3,
            deactivation_note = $4
        WHERE id = $1
          AND status = 'ACTIVE'
      `,
      [data.id, data.actorId, data.reasonCode, data.note],
    );
    return (result.rowCount || 0) > 0;
  }

  async reactivateUser(id: number, executor?: QueryExecutor): Promise<boolean> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query(
      `
        UPDATE users
        SET status = 'ACTIVE',
            deactivated_at = NULL,
            deactivated_by = NULL,
            deactivation_reason_code = NULL,
            deactivation_note = NULL
        WHERE id = $1
          AND status <> 'ACTIVE'
      `,
      [id],
    );
    return (result.rowCount || 0) > 0;
  }

  async countActiveUsersByRole(
    role: string,
    executor?: QueryExecutor,
    options: { lockRows?: boolean } = {},
  ): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    if (options.lockRows === true) {
      const result = await queryExecutor.query<{ id: number }>(
        `SELECT id FROM users WHERE role = $1 AND status = 'ACTIVE' FOR UPDATE`,
        [role],
      );
      return result.rows.length;
    }
    const result = await queryExecutor.query<CountRow>(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = $1 AND status = 'ACTIVE'`,
      [role],
    );
    return Number.parseInt(String(result.rows[0]?.count || '0'), 10);
  }

  async usernameExists(username: string, executor?: QueryExecutor): Promise<boolean> {
    const result = await this.getExecutor(executor).query<{ exists: boolean }>(
      `SELECT TRUE AS exists FROM users WHERE username = $1 LIMIT 1`,
      [username],
    );
    return result.rows.length > 0;
  }

  async updateUser(data: UpdateUserRecordInput, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    const setClauses = [
      `username = $1`,
      `"FirstName" = $2`,
      `"LastName" = $3`,
      `"PersonID_Onec" = $4`,
      `phone = $5`,
      `email = $6`,
      `affiliation = $7`,
      `line_id = $8`,
      `address_line = $9`,
      `address_village_no = $10`,
      `address_street = $11`,
      `address_soi = $12`,
      `address_trok = $13`,
      `address_sub_district = $14`,
      `address_district = $15`,
      `address_province = $16`,
      `address_postal_code = $17`,
      `address_latitude = $18`,
      `address_longitude = $19`,
      `status = $20`,
      `permissions = $21`,
      `role = $22`,
      `data_scope = $23`,
      `updated_by = $24`,
    ];

    const params: unknown[] = [
      data.username,
      data.firstName,
      data.lastName,
      data.personIdOnec,
      data.phone,
      data.email,
      data.affiliation,
      data.lineId,
      data.addressLine,
      data.addressVillageNo,
      data.addressStreet,
      data.addressSoi,
      data.addressTrok,
      data.addressSubDistrict,
      data.addressDistrict,
      data.addressProvince,
      data.addressPostalCode,
      data.addressLatitude,
      data.addressLongitude,
      data.status,
      JSON.stringify(data.permissions),
      data.role,
      JSON.stringify(data.dataScope),
      data.updatedBy,
    ];

    let idParamIndex = params.length + 1;

    if (data.passwordHash) {
      // An explicitly-set password is a real password, not a temporary one —
      // leave the temporary-password lifecycle (mirrors createUser, where only
      // system-generated passwords set must_change_password).
      setClauses.push(
        `password = $${idParamIndex}`,
        `must_change_password = FALSE`,
        `temporary_password_issued_at = NULL`,
        `temporary_password_expires_at = NULL`,
      );
      params.push(data.passwordHash);
      idParamIndex += 1;
    }

    params.push(data.id);

    await queryExecutor.query(
      `
        UPDATE users
        SET ${setClauses.join(', ')}
        WHERE id = $${idParamIndex}
      `,
      params,
    );
  }

  async updateOwnProfile(
    data: UpdateOwnProfileRecordInput,
    executor?: QueryExecutor,
  ): Promise<void> {
    await this.getExecutor(executor).query(
      `
        UPDATE users
        SET
          "FirstName" = $1,
          "LastName" = $2,
          phone = $3,
          email = $4,
          affiliation = $5,
          line_id = $6,
          address_line = $7,
          address_village_no = $8,
          address_street = $9,
          address_soi = $10,
          address_trok = $11,
          address_sub_district = $12,
          address_district = $13,
          address_province = $14,
          address_postal_code = $15,
          address_latitude = $16,
          address_longitude = $17,
          updated_by = $18
        WHERE id = $19
      `,
      [
        data.firstName,
        data.lastName,
        data.phone,
        data.email,
        data.affiliation,
        data.lineId,
        data.addressLine,
        data.addressVillageNo,
        data.addressStreet,
        data.addressSoi,
        data.addressTrok,
        data.addressSubDistrict,
        data.addressDistrict,
        data.addressProvince,
        data.addressPostalCode,
        data.addressLatitude,
        data.addressLongitude,
        data.updatedBy,
        data.id,
      ],
    );
  }

  async deleteUser(id: number, executor?: QueryExecutor): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query(`DELETE FROM users WHERE id = $1`, [id]);

    return result.rowCount || 0;
  }

  async listUserOperationalReferences(id: number, executor?: QueryExecutor): Promise<string[]> {
    const queryExecutor = this.getExecutor(executor);
    const pairs = Array.from(
      { length: USER_OPERATIONAL_REFERENCE_CHECKS.length },
      (_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`,
    ).join(', ');
    const columnsResult = await queryExecutor.query<UserReferenceColumnRow>(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (${pairs})
      `,
      USER_OPERATIONAL_REFERENCE_CHECKS.flatMap(({ table, column }) => [table, column]),
    );

    const references: string[] = [];
    for (const { table_name: tableName, column_name: columnName } of columnsResult.rows) {
      const result = await queryExecutor.query<UserReferenceExistsRow>(
        `
          SELECT TRUE AS exists
          FROM ${quoteIdentifier(tableName)}
          WHERE ${quoteIdentifier(columnName)} = $1
          LIMIT 1
        `,
        [id],
      );

      if (result.rows.length > 0) {
        references.push(`${tableName}.${columnName}`);
      }
    }

    return references.sort();
  }

  async findUserByUsername(username: string): Promise<HydratableUserRow | null> {
    const result = await this.query<HydratableUserRow>(
      `
        SELECT
          ${this.userFieldsSql},
          u.password
        FROM users u
        LEFT JOIN roles r ON r.name = u.role
        WHERE u.username = $1
      `,
      [username],
    );

    return result.rows[0] || null;
  }

  async findCurrentStudentUuidByUserId(userId: number): Promise<string | null> {
    const result = await this.query<{ student_uuid: string }>(
      `
      SELECT current_enrollment.selected_student_uuid AS student_uuid
      FROM users u
      JOIN student_current_enrollment_resolution current_enrollment
        ON current_enrollment.person_uuid = u.person_uuid
       AND current_enrollment.resolution_state = 'ACTIVE'
      WHERE u.id = $1
        AND u.role = 'STUDENT'
        AND u.status = 'ACTIVE'
    `,
      [userId],
    );
    return result.rows[0]?.student_uuid ?? null;
  }

  async listPlaintextPasswordUsers(): Promise<Array<{ id: number; password: string }>> {
    const result = await this.query<{ id: number; password: string }>(
      `SELECT id, password FROM users WHERE password NOT LIKE '$2%'`,
    );

    return result.rows;
  }

  async updatePasswordHash(
    id: number,
    passwordHash: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(`UPDATE users SET password = $1 WHERE id = $2`, [passwordHash, id]);
  }

  async updatePasswordAndClearMustChange(
    id: number,
    passwordHash: string,
    executor?: QueryExecutor,
  ): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(
      `
        UPDATE users
        SET password = $1,
            must_change_password = FALSE,
            temporary_password_issued_at = NULL,
            temporary_password_expires_at = NULL
        WHERE id = $2
      `,
      [passwordHash, id],
    );
  }

  async reissueTemporaryPassword(
    id: number,
    passwordHash: string,
    issuedAt: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.query(
      `
        UPDATE users
        SET password = $2,
            must_change_password = TRUE,
            temporary_password_issued_at = $3,
            temporary_password_expires_at = $4
        WHERE id = $1
          AND status = 'ACTIVE'
      `,
      [id, passwordHash, issuedAt, expiresAt],
    );
    return (result.rowCount || 0) > 0;
  }

  async createRole(data: CreateRoleRecordInput, executor?: QueryExecutor): Promise<RoleRow> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<RoleRow>(
      `
        INSERT INTO roles (
          name, label, rank, default_permissions, scope_mode, scope_policy,
          is_assignable, is_system, school_id
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, TRUE, FALSE, $7)
        RETURNING id, name, label, rank, default_permissions, scope_mode,
          scope_policy, is_assignable, is_system, school_id
      `,
      [
        data.name,
        data.label,
        data.rank,
        JSON.stringify(data.default_permissions),
        data.scope_mode,
        data.scope_policy,
        data.school_id,
      ],
    );

    return result.rows[0];
  }

  async updateRole(
    name: string,
    data: Omit<CreateRoleRecordInput, 'school_id'>,
    executor?: QueryExecutor,
  ): Promise<RoleRow> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<RoleRow>(
      `
        UPDATE roles
        SET label = $2,
            rank = $3,
            default_permissions = $4::jsonb,
            scope_mode = $5,
            scope_policy = $6
        WHERE name = $1
        RETURNING id, name, label, rank, default_permissions, scope_mode,
          scope_policy, is_assignable, is_system, school_id
      `,
      [
        name,
        data.label,
        data.rank,
        JSON.stringify(data.default_permissions),
        data.scope_mode,
        data.scope_policy,
      ],
    );

    return result.rows[0];
  }

  async deleteRole(name: string, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(`DELETE FROM roles WHERE name = $1`, [name]);
  }
}
