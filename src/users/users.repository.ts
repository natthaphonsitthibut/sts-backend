import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  DataScope,
  HydratableUserRow,
  QueryExecutor,
  QueryResultLike,
  RoleRow,
  StudentAccountCandidateRow,
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
  status: string;
  permissions: string[];
  role: string;
  dataScope: DataScope;
  updatedBy: number | null;
}

interface CreateRoleRecordInput {
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: string;
}

export interface UserListFilters {
  actorId: number;
  actorRole: string | null;
  actorRank: number;
  actorScope?: DataScope;
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

export interface StudentAccountCandidateFilters {
  actorScope?: DataScope;
  schoolId?: number;
  grade?: string;
  room?: number;
  onlyWithoutAccount?: boolean;
  limit?: number;
}

interface ScopeQuery {
  sql: string;
  params: unknown[];
}

interface CountRow extends Record<string, unknown> {
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
    u.status,
    u.permissions,
    u.role,
    u.data_scope,
    u.must_change_password,
    u.temporary_password_issued_at,
    u.temporary_password_expires_at,
    u.created_at,
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

  private normalizeScopeArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
    );
  }

  private buildJsonScopeSubsetQuery(
    scopeSql: string,
    actorScope: DataScope | undefined,
    startIndex = 1,
  ): ScopeQuery {
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

  async listRoleRows(includeUsage = false): Promise<RoleRow[]> {
    const sql = includeUsage
      ? `
          SELECT
            r.id,
            r.name,
            r.label,
            r.rank,
            r.default_permissions,
            r.scope_mode,
            r.is_system,
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
          ORDER BY r.rank DESC, r.name ASC
        `
      : `
          SELECT
            id,
            name,
            label,
            rank,
            default_permissions,
            scope_mode,
            is_system
          FROM roles
          ORDER BY rank DESC, name ASC
        `;

    const result = await this.query<RoleRow>(sql);
    return result.rows;
  }

  async listUsersPaginated(
    filters: UserListFilters,
  ): Promise<{ rows: HydratableUserRow[]; totalCount: number }> {
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

    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const offset = (page - 1) * limit;
    const selectParams = [...params, limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;

    const result = await this.query<HydratableUserRow>(
      `
        ${this.userSelectSql}
        ${whereSql}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    );

    return { rows: result.rows, totalCount };
  }

  async findUserById(id: number): Promise<HydratableUserRow | null> {
    const result = await this.query<HydratableUserRow>(
      `
        ${this.userSelectSql}
        WHERE u.id = $1
      `,
      [id],
    );

    return result.rows[0] || null;
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
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

  private buildStudentAccountCandidateQuery(filters: StudentAccountCandidateFilters): {
    whereSql: string;
    params: unknown[];
  } {
    const params: unknown[] = [];
    const conditions = [
      's.deleted_at IS NULL',
      's.person_uuid IS NOT NULL',
      `s."StudentStatusID_Onec" = 10`,
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

    if (typeof filters.schoolId === 'number') {
      params.push(filters.schoolId);
      conditions.push(`s."SchoolID_Onec" = $${params.length}`);
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
    const { whereSql, params } = this.buildStudentAccountCandidateQuery(filters);
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
        JOIN schools sc ON sc.id = s."SchoolID_Onec"
        LEFT JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
        LEFT JOIN users existing_user
          ON existing_user.person_uuid = s.person_uuid
         AND existing_user.role = 'STUDENT'
         AND existing_user.status = 'ACTIVE'
        ${whereSql}
        ORDER BY s."SchoolID_Onec", s."GradeLevelID_Onec", s."RoomID_Onec", s."PersonID_Onec"
        LIMIT $${params.length + 1}
      `,
      [...params, limit],
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
      `status = $8`,
      `permissions = $9`,
      `role = $10`,
      `data_scope = $11`,
      `updated_by = $12`,
    ];

    const params: unknown[] = [
      data.username,
      data.firstName,
      data.lastName,
      data.personIdOnec,
      data.phone,
      data.email,
      data.affiliation,
      data.status,
      JSON.stringify(data.permissions),
      data.role,
      JSON.stringify(data.dataScope),
      data.updatedBy,
    ];

    let idParamIndex = params.length + 1;

    if (data.passwordHash) {
      setClauses.push(`password = $${idParamIndex}`);
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

  async deleteUser(id: number, executor?: QueryExecutor): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query(`DELETE FROM users WHERE id = $1`, [id]);

    return result.rowCount || 0;
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

  async createRole(data: CreateRoleRecordInput, executor?: QueryExecutor): Promise<RoleRow> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<RoleRow>(
      `
        INSERT INTO roles (name, label, rank, default_permissions, scope_mode, is_system)
        VALUES ($1, $2, $3, $4::jsonb, $5, FALSE)
        RETURNING id, name, label, rank, default_permissions, scope_mode, is_system
      `,
      [data.name, data.label, data.rank, JSON.stringify(data.default_permissions), data.scope_mode],
    );

    return result.rows[0];
  }

  async updateRole(
    name: string,
    data: CreateRoleRecordInput,
    executor?: QueryExecutor,
  ): Promise<RoleRow> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<RoleRow>(
      `
        UPDATE roles
        SET label = $2,
            rank = $3,
            default_permissions = $4::jsonb,
            scope_mode = $5
        WHERE name = $1
        RETURNING id, name, label, rank, default_permissions, scope_mode, is_system
      `,
      [name, data.label, data.rank, JSON.stringify(data.default_permissions), data.scope_mode],
    );

    return result.rows[0];
  }

  async deleteRole(name: string, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);
    await queryExecutor.query(`DELETE FROM roles WHERE name = $1`, [name]);
  }
}
