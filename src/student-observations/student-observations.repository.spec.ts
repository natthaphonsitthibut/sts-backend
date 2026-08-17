import type { DataSource, QueryRunner } from 'typeorm';
import { StudentObservationsRepository } from './student-observations.repository';
import type { ObservationWriteInput, StudentObservationRow } from './student-observations.types';

const STUDENT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const OBSERVATION: StudentObservationRow = {
  id: '51',
  student_uuid: STUDENT_UUID,
  school_id: 10,
  author_kind: 'TEACHER_ACCESS',
  author_user_id: 44,
  author_username: 'teacher.one',
  author_display_name: 'ครู หนึ่ง',
  author_teacher_membership_id: '12',
  source_teacher_access_grant_id: '11111111-1111-4111-8111-111111111111',
  source_assignment_id: '31',
  subject_id: 8,
  subject_code: 'MATH',
  subject_name: 'คณิตศาสตร์',
  observation_dimension_id: '2',
  dimension_code: 'LEARNING',
  dimension_label: 'การเรียน',
  concern_level: 'NOTE',
  comment: null,
  comment_required: false,
  observed_at: new Date(),
  revision_number: 1,
  created_at: new Date(),
  updated_at: new Date(),
  tags: [],
};

function createHarness() {
  const rawQuery = jest.fn(
    (
      sql: string,
      _params?: unknown[],
      _structured?: boolean,
    ): Promise<{ records: Record<string, unknown>[]; affected: number }> => {
      void _params;
      void _structured;
      if (sql.includes('INSERT INTO student_observations')) {
        return Promise.resolve({ records: [{ id: '51' }], affected: 1 });
      }
      if (sql.includes('FROM student_observations observation')) {
        return Promise.resolve({ records: [OBSERVATION], affected: 1 });
      }
      return Promise.resolve({ records: [], affected: 0 });
    },
  );
  const runner = { query: rawQuery } as unknown as QueryRunner;
  const repository = new StudentObservationsRepository({} as DataSource);
  return { repository, rawQuery, runner };
}

describe('StudentObservationsRepository', () => {
  it('enforces school, geography, grade and room scope for an enrollment', async () => {
    const { repository, rawQuery, runner } = createHarness();
    rawQuery.mockResolvedValueOnce({ records: [{ found: true }], affected: 1 });

    await repository.isTimetableSlotForEnrollment(
      901,
      {
        student_uuid: STUDENT_UUID,
        school_id: 10,
        grade_level_id: 11,
        room_id: 1,
        school_name: 'โรงเรียนหนึ่ง',
        school_status: 'ACTIVE',
        school_term_id: '21',
        academic_year: 2569,
        semester: 1,
        term_status: 'ACTIVE',
        term_starts_on: '2026-05-01',
        term_ends_on: '2027-03-31',
        classroom_id: '41',
        classroom_status: 'ACTIVE',
      },
      runner,
    );

    expect(String(rawQuery.mock.calls[0][0])).toContain('slot.classroom_id = $3');
    expect(rawQuery.mock.calls[0][1]).toEqual([901, 10, '41']);
  });

  it('resolves assignment and enrollment through every active server-side boundary', async () => {
    const { repository, rawQuery, runner } = createHarness();
    rawQuery.mockResolvedValueOnce({
      records: [
        {
          assignment_id: '31',
          teacher_membership_id: '12',
          teacher_id: '7',
          school_id: 10,
          school_term_id: '21',
          classroom_id: '41',
          subject_id: 8,
          assignment_kind: 'SUBJECT',
        },
      ],
      affected: 1,
    });

    await repository.findActiveAssignment(31, STUDENT_UUID, '2026-07-14', runner);

    const sql = String(rawQuery.mock.calls[0][0]);
    expect(sql).toMatch(/enrollment\.student_uuid = \$2/);
    expect(sql).toMatch(/assignment\.assignment_status = 'ACTIVE'/);
    expect(sql).toMatch(/membership\.membership_status = 'ACTIVE'/);
    expect(sql).toMatch(/teacher\.teacher_status = 'ACTIVE'/);
    expect(sql).toMatch(/classroom\.classroom_status = 'ACTIVE'/);
    expect(sql).toMatch(/school\.school_status = 'ACTIVE'/);
    expect(sql).toMatch(/term\.status = 'ACTIVE'/);
    expect(rawQuery.mock.calls[0]).toEqual([
      expect.any(String),
      [31, STUDENT_UUID, '2026-07-14'],
      true,
    ]);
  });

  it('persists tags and a complete revision in the same transaction as creation', async () => {
    const { repository, rawQuery, runner } = createHarness();
    const input: ObservationWriteInput = {
      studentUuid: STUDENT_UUID,
      schoolId: 10,
      authorKind: 'TEACHER_ACCESS',
      authorUserId: 44,
      authorTeacherMembershipId: 12,
      sourceTeacherAccessGrantId: '11111111-1111-4111-8111-111111111111',
      sourceAssignmentId: 31,
      dimensionId: 2,
      concernLevel: 'NOTE',
      comment: null,
      commentRequired: false,
      observedAt: new Date('2026-07-14T08:00:00.000Z'),
      behaviorTagIds: [1, 2],
    };

    await expect(repository.createObservation(input, runner)).resolves.toMatchObject({ id: '51' });
    const combinedSql = rawQuery.mock.calls.map((call) => String(call[0])).join('\n');
    expect(combinedSql).toContain('INSERT INTO student_observation_tags');
    expect(combinedSql).toContain('INSERT INTO student_observation_revisions');
    const revisionCall = rawQuery.mock.calls.find((call) =>
      call[0].includes('INSERT INTO student_observation_revisions'),
    );
    expect(revisionCall?.[1]).toContain('["1","2"]');
  });

  it('uses bounded SQL pagination for raw observation timelines', async () => {
    const { repository, rawQuery, runner } = createHarness();
    await repository.listObservations(
      STUDENT_UUID,
      { page: 2, limit: 10, concernLevel: 'WATCH' },
      runner,
    );

    const call = rawQuery.mock.calls[0];
    expect(String(call[0])).toMatch(/COUNT\(\*\) OVER\(\).*LIMIT \$4 OFFSET \$5/s);
    expect(String(call[0])).toContain('WHERE observation.deleted_at IS NULL');
    expect(call[1]).toEqual([STUDENT_UUID, 'WATCH', null, 10, 10]);
  });

  it('uses bounded SQL pagination for revision history', async () => {
    const { repository, rawQuery, runner } = createHarness();
    await repository.listRevisions('51', 2, 10, runner);

    expect(String(rawQuery.mock.calls[0][0])).toMatch(
      /COUNT\(\*\) OVER\(\).*LIMIT \$2 OFFSET \$3/s,
    );
    expect(rawQuery.mock.calls[0][1]).toEqual(['51', 10, 10]);
  });
});
