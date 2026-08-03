import { CurriculumRepository } from './curriculum.repository';

describe('CurriculumRepository', () => {
  it('locks an offering when requested for an in-transaction mutation', async () => {
    const runner = {
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const repository = new CurriculumRepository({} as never);

    await repository.findSubjectById('31', runner as never, true);

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE OF offering'),
      ['31'],
      true,
    );
  });

  it('soft-deletes prior coverage before inserting its replacement set', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const runner = {
      query: jest.fn().mockImplementation((sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return Promise.resolve({ records: [], affected: 0 });
      }),
    };
    const repository = new CurriculumRepository({} as never);

    await repository.replaceTeacherCoverage(
      {
        curriculumSubjectId: '31',
        schoolId: 10,
        termId: 21,
        gradeLevelId: 4,
        coverage: [{ teacherMembershipId: 12, classroomId: 41 }],
        actorId: 7,
      },
      runner as never,
    );

    expect(calls[0].sql).toContain('UPDATE curriculum_subject_teachers');
    expect(calls[0].sql).toContain('deleted_at = now()');
    expect(calls[0].params).toEqual(['31', 7]);
    expect(calls[1].sql).toContain('INSERT INTO curriculum_subject_teachers');
  });
});
