import { DataExportsRepository } from './data-exports.repository';

function createRepositoryWithQueryCapture() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ records: [], affected: 0 });
    }),
  };
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  return {
    queries,
    repository: new DataExportsRepository(dataSource as never),
  };
}

describe('DataExportsRepository lifecycle guards', () => {
  it('only cancels pending jobs', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.cancelJob('00000000-0000-0000-0000-000000000001');

    expect(queries[0].sql).toContain("status = 'PENDING'");
    expect(queries[0].sql).not.toContain("'RUNNING'");
  });

  it('only completes a claimed running job', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.completeJob('00000000-0000-0000-0000-000000000001', {
      rowCount: 1,
      artifactSizeBytes: 10,
      artifactStorageKey: 'data-exports/job.csv',
      artifactSha256: 'a'.repeat(64),
      expiresAt: new Date('2026-07-15T00:00:00Z'),
    });

    expect(queries[0].sql).toContain("status = 'RUNNING'");
  });

  it('prepares retry with a failed-to-pending compare-and-set', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.prepareRetry('00000000-0000-0000-0000-000000000001');

    expect(queries[0].sql).toContain("SET status = 'PENDING'");
    expect(queries[0].sql).toContain("status = 'FAILED'");
  });

  it('expires completed jobs and records the immutable event atomically', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.expireCompletedJobs(new Date('2026-07-15T00:00:00Z'));

    expect(queries[0].sql).toContain("SET status = 'EXPIRED'");
    expect(queries[0].sql).toContain('event_code, metadata');
    expect(queries[0].sql).toContain("'EXPIRED'");
  });

  it('clears an artifact key only after the job is expired', async () => {
    const { queries, repository } = createRepositoryWithQueryCapture();

    await repository.clearExpiredArtifact(
      '00000000-0000-0000-0000-000000000001',
      'data-exports/job.csv',
    );

    expect(queries[0].sql).toContain('artifact_storage_key = NULL');
    expect(queries[0].sql).toContain("status = 'EXPIRED'");
  });
});
