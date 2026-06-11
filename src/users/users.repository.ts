import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  DataScope,
  HydratableUserRow,
  QueryExecutor,
  QueryResultLike,
  RoleRow,
} from './users.types';

interface CreateUserRecordInput {
  username: string;
  passwordHash: string;
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
  mustChangePassword: boolean;
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
}

interface CreateRoleRecordInput {
  name: string;
  label: string;
  rank: number;
  default_permissions: string[];
  scope_mode: string;
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
            SELECT login_role, COUNT(*) AS login_link_count
            FROM task_links
            WHERE login_role IS NOT NULL
            GROUP BY login_role
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

  async listUsers(): Promise<HydratableUserRow[]> {
    const result = await this.query<HydratableUserRow>(`
      ${this.userSelectSql}
      ORDER BY u.created_at DESC
    `);

    return result.rows;
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
          must_change_password
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        data.mustChangePassword,
      ],
    );

    return result.rows[0].id;
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
      `UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2`,
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
