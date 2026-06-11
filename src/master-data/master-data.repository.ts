import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type {
  MasterDataRow,
  MasterDataTable,
  MasterDataValueColumn,
  QueryResultLike,
} from './master-data.types';

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
