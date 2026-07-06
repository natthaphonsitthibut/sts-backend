import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../auth';
import { queryDataSource } from '../database/sql-query';
import type { FieldFollowerStatus } from './dto/field-followers.dto';
import type { FieldFollowerRow } from './field-followers.types';

export interface CreateFieldFollowerInput {
  firstName: string;
  lastName: string;
  phone: string;
  subDistrict: string | null;
  district: string | null;
  province: string | null;
}

export interface ListFieldFollowersFilters {
  status?: FieldFollowerStatus;
  province?: string;
  district?: string;
  subDistrict?: string;
  page: number;
  limit: number;
}

@Injectable()
export class FieldFollowersRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * `field_followers` is scoped by free-text province/district/sub_district
   * ("พื้นที่รับผิดชอบ" per task-field-monitor-map.md), not school_id. A
   * province/district-scoped admin matches directly; a school-scoped admin
   * (e.g. DIRECTOR, who is field-monitor's primary user) has no area arrays
   * on their own data_scope, so their assigned school's province/district is
   * resolved via `schools` as a fallback. Global actors see everything; a
   * non-global actor with neither area arrays nor school_ids is fail-closed.
   */
  private buildActorScopeClause(
    scope: DataScope,
    startIndex: number,
  ): { sql: string; params: unknown[] } {
    if (scope.global === true) {
      return { sql: '', params: [] };
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = startIndex;

    if (scope.provinces && scope.provinces.length > 0) {
      clauses.push(`province = ANY($${paramIndex++}::text[])`);
      params.push(scope.provinces);
    }
    if (scope.districts && scope.districts.length > 0) {
      clauses.push(`district = ANY($${paramIndex++}::text[])`);
      params.push(scope.districts);
    }
    if (scope.sub_districts && scope.sub_districts.length > 0) {
      clauses.push(`sub_district = ANY($${paramIndex++}::text[])`);
      params.push(scope.sub_districts);
    }
    if (scope.school_ids && scope.school_ids.length > 0) {
      clauses.push(
        `EXISTS (
          SELECT 1 FROM schools sc
          WHERE sc.id = ANY($${paramIndex++}::int[])
            AND sc.province = field_followers.province
            AND sc.district = field_followers.district
        )`,
      );
      params.push(scope.school_ids);
    }

    if (clauses.length === 0) {
      return { sql: '1=0', params: [] };
    }
    return { sql: clauses.join(' OR '), params };
  }

  async createApplication(input: CreateFieldFollowerInput): Promise<FieldFollowerRow> {
    const result = await queryDataSource<FieldFollowerRow>(
      this.dataSource,
      `
        INSERT INTO field_followers (first_name, last_name, phone, sub_district, district, province)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [
        input.firstName,
        input.lastName,
        input.phone,
        input.subDistrict,
        input.district,
        input.province,
      ],
    );
    return result.rows[0];
  }

  async listFollowers(
    actorScope: DataScope,
    filters: ListFieldFollowersFilters,
  ): Promise<{ rows: FieldFollowerRow[]; totalCount: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scopeResult = this.buildActorScopeClause(actorScope, params.length + 1);
    if (scopeResult.sql) {
      conditions.push(`(${scopeResult.sql})`);
      params.push(...scopeResult.params);
    }

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.province) {
      params.push(filters.province);
      conditions.push(`province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      conditions.push(`district = $${params.length}`);
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      conditions.push(`sub_district = $${params.length}`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (filters.page - 1) * filters.limit;
    params.push(filters.limit, offset);

    const result = await queryDataSource<FieldFollowerRow>(
      this.dataSource,
      `
        SELECT *, COUNT(*) OVER ()::int AS total_count
        FROM field_followers
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    const totalCount = Number.parseInt(String(result.rows[0]?.total_count ?? '0'), 10);
    return { rows: result.rows, totalCount };
  }

  async findByIdInScope(id: string, actorScope: DataScope): Promise<FieldFollowerRow | null> {
    const scopeResult = this.buildActorScopeClause(actorScope, 2);
    const whereScope = scopeResult.sql ? ` AND (${scopeResult.sql})` : '';
    const result = await queryDataSource<FieldFollowerRow>(
      this.dataSource,
      `SELECT * FROM field_followers WHERE id = $1${whereScope}`,
      [id, ...scopeResult.params],
    );
    return result.rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    nextStatus: FieldFollowerStatus,
    reviewerUserId: number,
  ): Promise<FieldFollowerRow | null> {
    const result = await queryDataSource<FieldFollowerRow>(
      this.dataSource,
      `
        UPDATE field_followers
        SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, nextStatus, reviewerUserId],
    );
    return result.rows[0] ?? null;
  }
}
