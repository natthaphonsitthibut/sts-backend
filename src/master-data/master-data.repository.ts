import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import { getMasterDataValueColumn } from './master-data.types';
import type {
  MasterDataRow,
  MasterDataTable,
  MasterDataValueColumn,
  QueryResultLike,
} from './master-data.types';

interface ListRowsPaginatedOptions {
  page: number;
  limit: number;
  searchTerm?: string;
}

interface CountRow extends Record<string, unknown> {
  total: number;
}

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

    const searchColumns =
      table === 'schools'
        ? ['name', 'province', 'district', 'sub_district']
        : [getMasterDataValueColumn(table)];
    const params = [`%${trimmedSearch}%`];
    const conditions = searchColumns.map((column) => `COALESCE(${column}::text, '') ILIKE $1`);

    return {
      whereSql: ` WHERE (${conditions.join(' OR ')})`,
      params,
    };
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

  async deleteRow(table: MasterDataTable, id: number): Promise<MasterDataRow | null> {
    const result = (await queryDataSource<MasterDataRow>(
      this.dataSource,
      `DELETE FROM ${table} WHERE id = $1 RETURNING *`,
      [id],
    )) as QueryResultLike<MasterDataRow>;

    return result.rows[0] || null;
  }
}
