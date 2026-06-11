import { DataSource, QueryRunner } from 'typeorm';

export interface SqlQueryResult<T extends Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlQueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<SqlQueryResult<T>>;
}

interface StructuredQueryResult<T extends Record<string, unknown>> {
  records?: T[];
  affected?: number;
}

function normalizeQueryResult<T extends Record<string, unknown>>(
  result: unknown,
): SqlQueryResult<T> {
  if (Array.isArray(result)) {
    return {
      rows: result as T[],
      rowCount: result.length,
    };
  }

  if (typeof result === 'object' && result !== null) {
    const structured = result as StructuredQueryResult<T>;
    const rows = Array.isArray(structured.records) ? structured.records : [];

    return {
      rows,
      rowCount: typeof structured.affected === 'number' ? structured.affected : rows.length,
    };
  }

  return {
    rows: [],
    rowCount: 0,
  };
}

async function runStructuredQuery<T extends Record<string, unknown>>(
  queryRunner: QueryRunner,
  sql: string,
  params?: unknown[],
): Promise<SqlQueryResult<T>> {
  const result = await queryRunner.query(sql, params, true);
  return normalizeQueryResult<T>(result);
}

export function createSqlQueryExecutor(queryRunner: QueryRunner): SqlQueryExecutor {
  return {
    query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      return await runStructuredQuery<T>(queryRunner, sql, params);
    },
  };
}

export async function queryDataSource<T extends Record<string, unknown>>(
  dataSource: DataSource,
  sql: string,
  params?: unknown[],
): Promise<SqlQueryResult<T>> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    return await runStructuredQuery<T>(queryRunner, sql, params);
  } finally {
    await queryRunner.release();
  }
}

export async function withDataSourceTransaction<T>(
  dataSource: DataSource,
  callback: (executor: SqlQueryExecutor) => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const result = await callback(createSqlQueryExecutor(queryRunner));
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
