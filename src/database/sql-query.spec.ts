import { queryDataSource, withDataSourceTransaction } from './sql-query';

describe('withDataSourceTransaction', () => {
  it('routes nested queryDataSource calls through one REPEATABLE READ runner', async () => {
    const query = jest.fn().mockResolvedValue({ records: [{ id: 1 }], affected: 1 });
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query,
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };

    const result = await withDataSourceTransaction(
      dataSource as never,
      async () => await queryDataSource<{ id: number }>(dataSource as never, 'SELECT 1'),
      'REPEATABLE READ',
    );

    expect(result.rows).toEqual([{ id: 1 }]);
    expect(runner.startTransaction).toHaveBeenCalledWith('REPEATABLE READ');
    expect(query).toHaveBeenCalledWith('SELECT 1', undefined, true);
    expect(dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
