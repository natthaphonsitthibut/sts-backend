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

  it('keeps teacher-link observations visible after their login account is retired', async () => {
    const { repository, queries } = buildRepository();

    await repository.listTeacherObservationReports({ school_ids: [101] }, { page: 1, limit: 20 });

    expect(queries[0].sql).toContain(
      'LEFT JOIN users author ON author.id = observation.author_user_id',
    );
    expect(queries[0].sql).toContain('observation.observer_display_name');
  });

  it('lists one latest classroom comment per currently enrolled student within actor scope', async () => {
    const { repository, queries } = buildRepository();
    await repository.listTeacherWatchlist(
      { school_ids: [101] },
      { searchTerm: 'เด็ก', schoolId: 101, grade: 'ป.1', room: '1', page: 2, limit: 20 },
    );

    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('comment.problem_description');
    expect(queries[0].sql).toContain('enrollment.classroom_id = comment.classroom_id');
    expect(queries[0].sql).toContain('COUNT(*) OVER (PARTITION BY comment.person_uuid)');
    expect(queries[0].sql).toContain('ROW_NUMBER() OVER');
    expect(queries[0].sql).toContain('WHERE comment_rank = 1');
    expect(queries[0].sql).not.toContain('FROM student_observations observation');
    expect(queries[0].sql).toContain('watchlist.school_id = ANY');
    expect(queries[0].params).toEqual(['%เด็ก%', 101, 'ป.1', '1', [101], 20, 20]);
  });

  it('lists the latest classroom comments for one current student within actor scope', async () => {
    const { repository, queries } = buildRepository();

    await repository.listStudentClassroomComments(
      { school_ids: [101] },
      '11111111-1111-4111-8111-111111111111',
      3,
    );

    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('comment.problem_category');
    expect(queries[0].sql).toContain('comment.problem_description');
    expect(queries[0].sql).toContain('enrollment.classroom_id = comment.classroom_id');
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('enrollment.student_uuid = $1');
    expect(queries[0].sql).toContain('school.id = ANY');
    expect(queries[0].params).toEqual(['11111111-1111-4111-8111-111111111111', [101], 3]);
  });
});
