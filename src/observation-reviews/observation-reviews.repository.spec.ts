import { ObservationReviewsRepository } from './observation-reviews.repository';

describe('ObservationReviewsRepository', () => {
  function buildRepository() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
    return {
      repository: new ObservationReviewsRepository(dataSource as never),
      queryRunner,
      queries,
    };
  }

  it('validates exact observation revisions against the requested student', async () => {
    const { repository, queryRunner, queries } = buildRepository();
    await repository.validateObservationSources(
      '11111111-1111-4111-8111-111111111111',
      [{ observationId: 9, revision: 2 }],
      queryRunner as never,
    );

    expect(queries[0].sql).toContain('observation.student_uuid = $1');
    expect(queries[0].sql).toContain('revision.revision_number = source.observation_revision');
    expect(queries[0].params).toEqual(['11111111-1111-4111-8111-111111111111', [9], [2]]);
  });

  it('updates only the pre-case request when a reviewer decides', async () => {
    const { repository, queryRunner, queries } = buildRepository();
    await repository.reviewFollowUp(
      '22222222-2222-4222-8222-222222222222',
      2,
      'APPROVED',
      'approved',
      5,
      123,
      queryRunner as never,
    );

    expect(queries[0].sql).toContain('UPDATE student_follow_up_requests');
    expect(queries[0].sql).toContain("status = 'PENDING_REVIEW'");
    expect(queries[0].sql).not.toContain('UPDATE cases');
    expect(queries[0].sql).not.toContain('INSERT INTO tasks');
    expect(queries[0].sql).not.toContain('student_risk_profiles');
  });

  it('derives calculated attendance risk without mutating the profile', async () => {
    const { repository, queryRunner, queries } = buildRepository();
    await repository.findCalculatedAttendanceRisk(
      '11111111-1111-4111-8111-111111111111',
      queryRunner as never,
    );
    expect(queries[0].sql).toContain('LEFT JOIN student_risk_profiles');
    expect(queries[0].sql).toContain("COALESCE(profile.risk_tier, 'UNKNOWN')");
    expect(queries[0].sql).not.toContain('UPDATE student_risk_profiles');
  });

  it('lists one latest observation per currently enrolled student within actor scope', async () => {
    const { repository, queries } = buildRepository();
    await repository.listTeacherWatchlist(
      { school_ids: [101] },
      { searchTerm: 'เด็ก', schoolId: 101, grade: 'ป.1', room: '1', page: 2, limit: 20 },
    );

    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('COUNT(*) OVER (PARTITION BY observation.student_uuid)');
    expect(queries[0].sql).toContain('ROW_NUMBER() OVER');
    expect(queries[0].sql).toContain('WHERE observation_rank = 1');
    expect(queries[0].sql).toContain('watchlist.school_id = ANY');
    expect(queries[0].params).toEqual(['%เด็ก%', 101, 'ป.1', '1', [101], 20, 20]);
  });
});
