import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { createSqlQueryExecutor, queryDataSource } from '../database/sql-query';
import { getCodedMasterDataWritableColumns, getMasterDataValueColumn } from './master-data.types';
import type {
  CodedMasterDataColumn,
  CodedMasterDataTable,
  MasterDataRow,
  MasterDataTable,
  MasterDataValueColumn,
  QueryResultLike,
  SchoolMasterDataInput,
  SchoolMasterDataRow,
} from './master-data.types';

interface ListRowsPaginatedOptions {
  page: number;
  limit: number;
  searchTerm?: string;
}

interface CountRow extends Record<string, unknown> {
  total: number;
}

const SCHOOL_SELECT_COLUMNS = `
  sc.id,
  sc.name,
  sc.province,
  sc.district,
  sc.sub_district,
  sc.school_status
`;

export type CodedMasterDataInput = Partial<Record<CodedMasterDataColumn, unknown>>;

@Injectable()
export class MasterDataRepository {
  constructor(private readonly dataSource: DataSource) {}

  async listRows(table: MasterDataTable): Promise<MasterDataRow[]> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `SELECT * FROM ${table} ORDER BY id ASC`,
    )) as QueryResultLike<MasterDataRow>;

    return result.rows;
  }

  async listRowsPaginated(
    table: MasterDataTable,
    options: ListRowsPaginatedOptions,
  ): Promise<{ rows: MasterDataRow[]; totalCount: number }> {
    const { whereSql, params } = this.buildSearchWhere(table, options.searchTerm);

    const countResult = (await queryDataSource<CountRow>(
      this.dataSource,
      `SELECT COUNT(*)::int AS total FROM ${table}${whereSql}`,
      params,
    )) as QueryResultLike<CountRow>;
    const totalCount = countResult.rows[0]?.total ?? 0;

    const offset = (options.page - 1) * options.limit;
    const selectParams = [...params, options.limit, offset];
    const limitPlaceholder = selectParams.length - 1;
    const offsetPlaceholder = selectParams.length;

    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `
        SELECT *
        FROM ${table}
        ${whereSql}
        ORDER BY id ASC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      selectParams,
    )) as QueryResultLike<MasterDataRow>;

    return { rows: result.rows, totalCount };
  }

  private buildSearchWhere(
    table: MasterDataTable,
    searchTerm?: string,
  ): { whereSql: string; params: unknown[] } {
    const trimmedSearch = searchTerm?.trim();
    if (!trimmedSearch) {
      return { whereSql: '', params: [] };
    }

    const searchColumns = this.getSearchColumns(table);
    const params = [`%${trimmedSearch}%`];
    const conditions = searchColumns.map((column) => `COALESCE(${column}::text, '') ILIKE $1`);

    return {
      whereSql: ` WHERE (${conditions.join(' OR ')})`,
      params,
    };
  }

  private getSearchColumns(table: MasterDataTable): string[] {
    if (table === 'disability_types') {
      return ['code', 'name', 'legal_category', 'note'];
    }
    if (
      table === 'school_affiliations' ||
      table === 'absence_reason_categories' ||
      table === 'absence_reasons' ||
      table === 'non_follow_up_reasons'
    ) {
      return ['code', 'name', 'note'];
    }

    return [getMasterDataValueColumn(table)];
  }

  async listSchools(
    options: ListRowsPaginatedOptions,
    scope: DataScope,
  ): Promise<{ rows: SchoolMasterDataRow[]; totalCount: number }> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'sc.id',
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      1,
    );
    const conditions = [scopeQuery.sql || 'TRUE'];
    const params = [...scopeQuery.params];
    const searchTerm = options.searchTerm?.trim();
    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      conditions.push(`(
        sc.name ILIKE $${params.length}
        OR COALESCE(sc.province, '') ILIKE $${params.length}
        OR COALESCE(sc.district, '') ILIKE $${params.length}
        OR COALESCE(sc.sub_district, '') ILIKE $${params.length}
      )`);
    }
    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const countResult = await queryDataSource<CountRow>(
      this.dataSource,
      `SELECT COUNT(*)::int AS total FROM schools sc ${whereSql}`,
      params,
    );
    const offset = (options.page - 1) * options.limit;
    const listParams = [...params, options.limit, offset];
    const limitPlaceholder = listParams.length - 1;
    const offsetPlaceholder = listParams.length;
    const result = await queryDataSource<SchoolMasterDataRow>(
      this.dataSource,
      `
        SELECT ${SCHOOL_SELECT_COLUMNS}
        FROM schools sc
        ${whereSql}
        ORDER BY sc.id ASC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      listParams,
    );

    return { rows: result.rows, totalCount: countResult.rows[0]?.total ?? 0 };
  }

  async findSchoolById(
    id: number,
    scope: DataScope,
    queryRunner?: QueryRunner,
  ): Promise<SchoolMasterDataRow | null> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'sc.id',
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      2,
    );
    const sql = `
      SELECT ${SCHOOL_SELECT_COLUMNS}
      FROM schools sc
      WHERE sc.id = $1 AND ${scopeQuery.sql || 'TRUE'}
      LIMIT 1
      ${queryRunner ? 'FOR UPDATE' : ''}
    `;
    if (queryRunner) {
      const rows = (await queryRunner.query(sql, [
        id,
        ...scopeQuery.params,
      ])) as SchoolMasterDataRow[];
      return rows[0] ?? null;
    }
    const result = await queryDataSource<SchoolMasterDataRow>(this.dataSource, sql, [
      id,
      ...scopeQuery.params,
    ]);
    return result.rows[0] ?? null;
  }

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

  async createSchool(
    id: number,
    input: SchoolMasterDataInput,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolMasterDataRow> {
    const result = await createSqlQueryExecutor(queryRunner).query<SchoolMasterDataRow>(
      `
        INSERT INTO schools (
          id, name, province, district, sub_district, school_status, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $6)
        RETURNING id, name, province, district, sub_district, school_status
      `,
      [id, input.name, input.province, input.district, input.subDistrict, actorId],
    );
    return result.rows[0];
  }

  async createDefaultSchoolRoleGroups(schoolId: number, queryRunner: QueryRunner): Promise<void> {
    await createSqlQueryExecutor(queryRunner).query(
      `
        WITH templates(template_key, label, source_name, fallback_source_name) AS (
          VALUES
            ('ADMIN', 'ผู้ดูแลระบบ', 'ADMIN', NULL::TEXT),
            ('EXECUTIVE', 'ผู้บริหาร', 'EXECUTIVE', NULL::TEXT),
            ('ADMIN_SCHOOL', 'ผู้ดูแลระบบประจำโรงเรียน', 'ADMIN_SCHOOL', 'ADMIN'),
            ('DIRECTOR', 'ผู้อำนวยการ', 'DIRECTOR', NULL::TEXT)
        ),
        template_roles AS (
          SELECT
            template.template_key,
            template.label,
            source_role.rank,
            source_role.default_permissions
          FROM templates template
          JOIN LATERAL (
            SELECT role_record.rank, role_record.default_permissions
            FROM roles role_record
            WHERE role_record.school_id IS NULL
              AND role_record.name IN (
                template.source_name,
                COALESCE(template.fallback_source_name, template.source_name)
              )
            ORDER BY CASE WHEN role_record.name = template.source_name THEN 0 ELSE 1 END
            LIMIT 1
          ) source_role ON TRUE
        )
        INSERT INTO roles (
          name, label, rank, default_permissions, scope_mode, scope_policy,
          is_assignable, is_system, school_id
        )
        SELECT
          'S' || $1 || '_BASE_' || template.template_key,
          template.label,
          template.rank,
          template.default_permissions,
          'school',
          'ASSIGNABLE',
          TRUE,
          FALSE,
          $1
        FROM template_roles template
        WHERE NOT EXISTS (
          SELECT 1
          FROM roles existing_role
          WHERE existing_role.school_id = $1
            AND LOWER(BTRIM(existing_role.label)) = LOWER(BTRIM(template.label))
        )
        ON CONFLICT DO NOTHING
      `,
      [schoolId],
    );
  }

  async updateSchool(
    id: number,
    input: SchoolMasterDataInput,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolMasterDataRow | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<SchoolMasterDataRow>(
      `
        UPDATE schools
        SET name = $2,
            province = $3,
            district = $4,
            sub_district = $5,
            updated_by = $6
        WHERE id = $1
        RETURNING id, name, province, district, sub_district, school_status
      `,
      [id, input.name, input.province, input.district, input.subDistrict, actorId],
    );
    return result.rows[0] ?? null;
  }

  async disableSchool(
    id: number,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SchoolMasterDataRow | null> {
    const result = await createSqlQueryExecutor(queryRunner).query<SchoolMasterDataRow>(
      `
        UPDATE schools
        SET school_status = 'INACTIVE', updated_by = $2
        WHERE id = $1
        RETURNING id, name, province, district, sub_district, school_status
      `,
      [id, actorId],
    );
    return result.rows[0] ?? null;
  }

  async findRowById(table: MasterDataTable, id: number): Promise<MasterDataRow | null> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `SELECT * FROM ${table} WHERE id = $1`,
      [id],
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0] || null;
  }

  async createRow(
    table: MasterDataTable,
    valueColumn: MasterDataValueColumn,
    value: string,
  ): Promise<MasterDataRow> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `
        INSERT INTO ${table} (${valueColumn})
        VALUES ($1)
        RETURNING *;
      `,
      [value],
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0];
  }

  async createCodedRow(
    table: CodedMasterDataTable,
    data: CodedMasterDataInput,
  ): Promise<MasterDataRow> {
    const writableColumns = getCodedMasterDataWritableColumns(table);
    const columns = writableColumns.filter((column) => data[column] !== undefined);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const params = columns.map((column) => data[column]);

    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *;
      `,
      params,
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0];
  }

  async updateRow(
    table: MasterDataTable,
    id: number,
    valueColumn: MasterDataValueColumn,
    value: string,
  ): Promise<MasterDataRow | null> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `
        UPDATE ${table}
        SET ${valueColumn} = $1
        WHERE id = $2
        RETURNING *;
      `,
      [value, id],
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0] || null;
  }

  async updateCodedRow(
    table: CodedMasterDataTable,
    id: number,
    data: CodedMasterDataInput,
  ): Promise<MasterDataRow | null> {
    const writableColumns = getCodedMasterDataWritableColumns(table);
    const columns = writableColumns.filter((column) => data[column] !== undefined);
    const assignments = columns.map((column, index) => `${column} = $${index + 1}`);
    const params = columns.map((column) => data[column]);
    params.push(id);

    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `
        UPDATE ${table}
        SET ${assignments.join(', ')}
        WHERE id = $${params.length}
        RETURNING *;
      `,
      params,
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0] || null;
  }

  async deleteRow(table: MasterDataTable, id: number): Promise<MasterDataRow | null> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
      [id],
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0] || null;
  }
}
