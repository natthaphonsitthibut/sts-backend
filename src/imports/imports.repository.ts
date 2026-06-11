import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import type {
  ExistingSchoolIdRow,
  ImportTarget,
  ManualSchool,
  QueryExecutor,
  QueryResultLike,
} from './imports.types';

@Injectable()
export class ImportsRepository {
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

  async findExistingSchoolIds(schoolIds: number[]): Promise<number[]> {
    if (schoolIds.length === 0) {
      return [];
    }

    const result = await this.query<ExistingSchoolIdRow>(
      'SELECT id FROM schools WHERE id = ANY($1::int[])',
      [schoolIds],
    );

    return result.rows.map((row) => Number(row.id));
  }

  async upsertManualSchool(school: ManualSchool, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);

    await queryExecutor.query(
      `
        INSERT INTO schools (id, name, province, district, sub_district)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          province = EXCLUDED.province,
          district = EXCLUDED.district,
          sub_district = EXCLUDED.sub_district
      `,
      [
        school.id,
        school.name,
        school.province ?? null,
        school.district ?? null,
        school.sub_district ?? null,
      ],
    );
  }

  async insertImportRow(
    target: ImportTarget,
    row: Record<string, unknown>,
    executor?: QueryExecutor,
  ): Promise<number> {
    const queryExecutor = this.getExecutor(executor);
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    const result = await queryExecutor.query(
      `
        INSERT INTO ${target} (${columns.map((column) => `"${column}"`).join(', ')})
        VALUES (${placeholders})
        ON CONFLICT ("PersonID_Onec") DO NOTHING
      `,
      values,
    );

    return result.rowCount;
  }
}
