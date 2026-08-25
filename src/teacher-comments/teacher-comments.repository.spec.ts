import { TeacherCommentsRepository } from './teacher-comments.repository';

describe('TeacherCommentsRepository', () => {
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
    return { queries, repository: new TeacherCommentsRepository(dataSource as never) };
  }

  it('lists the latest classroom comments for one current student within actor scope', async () => {
    const { queries, repository } = buildRepository();

    await repository.listStudentClassroomComments(
      { school_ids: [101] },
      '11111111-1111-4111-8111-111111111111',
      3,
    );

    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('comment.problem_category');
    expect(queries[0].sql).toContain('comment.problem_description');
    expect(queries[0].sql).toContain('comment.concern_level_code');
    expect(queries[0].sql).toContain('enrollment.classroom_id = comment.classroom_id');
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('enrollment.student_uuid = $1');
    expect(queries[0].sql).toContain('school.id = ANY');
    expect(queries[0].sql).not.toContain('student_observations');
    expect(queries[0].params).toEqual(['11111111-1111-4111-8111-111111111111', [101], 3]);
  });

  it('pages every comment in scope and escapes the search term', async () => {
    const { queries, repository } = buildRepository();

    await repository.listClassroomComments(
      { school_ids: [101] },
      { page: 2, limit: 20, searchTerm: '50%' },
    );

    expect(queries[0].sql).toContain('FROM classroom_student_comments comment');
    expect(queries[0].sql).toContain('student_current_enrollment_resolution');
    expect(queries[0].sql).toContain("ESCAPE '\\'");
    expect(queries[0].sql).toContain('COUNT(*) OVER()::int AS total_count');
    expect(queries[0].params).toEqual([[101], '%50\\%%', 20, 20]);
  });
});
