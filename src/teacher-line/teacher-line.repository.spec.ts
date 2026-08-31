import { TeacherLineRepository } from './teacher-line.repository';

describe('TeacherLineRepository', () => {
  function setup() {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    return {
      repository: new TeacherLineRepository({
        createQueryRunner: jest.fn(() => runner),
      } as never),
      runner,
    };
  }

  it.each([
    [
      'email',
      (repository: TeacherLineRepository) =>
        repository.findActiveTeacherByEmail('teacher@example.com', 10),
    ],
    [
      'citizen id',
      (repository: TeacherLineRepository) =>
        repository.findActiveTeacherByCitizenId('1101700200018', 10),
    ],
  ])(
    'allows shared LINE verification by active school teachers via %s',
    async (_label, findTeacher) => {
      const { repository, runner } = setup();

      await findTeacher(repository);

      const [sql, params] = runner.query.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('classroom_homeroom_teacher_assignments');
      expect(sql).toContain('membership.school_id = $2');
      expect(params[1]).toBe(10);
    },
  );

  it('rechecks active school membership at the final LINE callback', async () => {
    const { repository, runner } = setup();

    await repository.hasActiveTeacherMembership('7', runner as never, 10);

    const [sql, params] = runner.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('classroom_homeroom_teacher_assignments');
    expect(sql).toContain('membership.school_id = $2::bigint');
    expect(params).toEqual(['7', 10]);
  });
});
