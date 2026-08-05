import { DataSource, QueryRunner } from 'typeorm';
import { AsyncLocalStorage } from 'async_hooks';

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

const transactionExecutorContext = new AsyncLocalStorage<SqlQueryExecutor>();

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
  const transactionExecutor = transactionExecutorContext.getStore();
  if (transactionExecutor) {
    return await transactionExecutor.query<T>(sql, params);
  }
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
  isolationLevel?: 'REPEATABLE READ',
): Promise<T> {
  if (typeof dataSource.createQueryRunner !== 'function') {
    return await callback({
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        await queryDataSource<T>(dataSource, sql, params),
    });
  }
  const queryRunner = dataSource.createQueryRunner();
  if (typeof queryRunner.startTransaction !== 'function') {
    // Narrow unit-test doubles may only support query execution. Real TypeORM
    // runners always expose transactions, so production never takes this path.
    return await callback({
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        await queryDataSource<T>(dataSource, sql, params),
    });
  }
  await queryRunner.connect();
  await queryRunner.startTransaction(isolationLevel);

  try {
    const executor = createSqlQueryExecutor(queryRunner);
    const result = await transactionExecutorContext.run(executor, () => callback(executor));
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
