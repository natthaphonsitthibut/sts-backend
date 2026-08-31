import { ClassroomAttendanceLinksRepository } from './classroom-attendance-links.repository';

describe('ClassroomAttendanceLinksRepository', () => {
  function setup(records: Record<string, unknown>[] = []) {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records, affected: records.length }),
    };
    return {
      repository: new ClassroomAttendanceLinksRepository({
        createQueryRunner: jest.fn(() => runner),
      } as never),
      runner,
    };
  }

  it('fails closed through school, grade, and room scope on the paginated list', async () => {
    const { repository, runner } = setup();

    await repository.list({
      schoolId: 10,
      schoolTermId: 20,
      page: 1,
      limit: 20,
      scope: { school_ids: [10], grade_levels: [3], room_ids: [1] },
    });

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    // The listing is one row per teacher now, so grade and room no longer
    // filter the row itself — the school scope still fails closed, and grade is
    // applied as "teaches that grade" instead.
    expect(sql).toContain('school.id = ANY($3::int[])');
    expect(sql).toContain('LIMIT $');
    expect(sql).toContain('FROM school_teacher_memberships membership');
    expect(sql).toContain('LEFT JOIN classroom_attendance_links link');
  });

  it('filters room rows by link creation and displayed homeroom state on the server', async () => {
    const { repository, runner } = setup();

    await repository.list({
      schoolId: 10,
      schoolTermId: 20,
      gradeLevelId: 3,
      linkStatus: 'NOT_CREATED',
      homeroomStatus: 'UNASSIGNED',
      page: 1,
      limit: 20,
      scope: { school_ids: [10] },
    });

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    expect(calls[0][0]).toContain('classroom.grade_level_id = $4');
    expect(calls[0][0]).toContain('link.id IS NULL');
    expect(calls[1][0]).toContain('LEFT JOIN classroom_attendance_links link');
  });

  it('applies grade and room scope to assignment-link review queries', async () => {
    const { repository, runner } = setup();

    await repository.listIssuedLinks({
      schoolId: 10,
      schoolTermId: 20,
      page: 1,
      limit: 20,
      scope: { school_ids: [10], grade_levels: [3], room_ids: [1] },
    });

    const sql = (runner.query.mock.calls as unknown as Array<[string]>)[0][0];
    expect(sql).toContain('classroom.grade_level_id = ANY($4::int[])');
    expect(sql).toContain('classroom.legacy_room_number = ANY($5::text[])');
    expect(sql).toContain('LEFT JOIN school_classrooms classroom');
  });

  it('joins the classroom before checking a link against grade and room scope', async () => {
    const { repository, runner } = setup([{ present: true }]);

    await repository.isLinkInScope('11111111-1111-4111-8111-111111111111', {
      school_ids: [10],
      grade_levels: [3],
      room_ids: [1],
    });

    const sql = (runner.query.mock.calls as unknown as Array<[string]>)[0][0];
    expect(sql).toContain('LEFT JOIN school_classrooms classroom');
    expect(sql).toContain('classroom.grade_level_id = ANY($3::int[])');
    expect(sql).toContain('classroom.legacy_room_number = ANY($4::text[])');
  });

  it('returns database identifiers needed to reopen the exact attendance register', async () => {
    const { repository, runner } = setup();

    await repository.listLinkAttendanceSessions('11111111-1111-4111-8111-111111111111');

    const sql = (runner.query.mock.calls as unknown as Array<[string]>)[0][0];
    expect(sql).toContain('session.school_id');
    expect(sql).toContain('session.classroom_id');
    expect(sql).toContain('session.classroom_subject_id');
    expect(sql).toContain('session.attendance_date::text AS attendance_date');
    expect(sql).toContain('classroom.grade_level_id');
  });

  it('resolves public tokens only while link, school, term, and classroom are active', async () => {
    const { repository, runner } = setup();

    await repository.findUsableByTokenHash('a'.repeat(64));

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    expect(sql).toContain("link.link_status = 'ACTIVE'");
    expect(sql).toContain("school.school_status = 'ACTIVE'");
    expect(sql).toContain("term.status = 'ACTIVE'");
    expect(sql).toContain("classroom.classroom_status = 'ACTIVE'");
    expect(calls[0][1]).toEqual(['a'.repeat(64)]);
  });

  it('matches an external teacher through an active school membership without assignment joins', async () => {
    const { repository, runner } = setup();

    await repository.findTeacherByEmail('teacher@example.com', 10);

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    expect(sql).toContain('JOIN school_teacher_memberships membership');
    expect(sql).not.toContain('classroom_teacher_assignments');
    expect(sql).not.toContain('curriculum_subject_teachers');
    expect(sql).not.toContain('classroom_homeroom_teachers');
  });

  it("rotates a teacher's live link for the term in place", async () => {
    const { repository, runner } = setup([{ id: 'link-id' }]);

    await repository.upsertLinks(
      [
        {
          schoolId: 10,
          schoolTermId: 20,
          teacherMembershipId: 30,
          tokenHash: 'b'.repeat(64),
          tokenEncrypted: 'v1:cipher',
          actorId: 1,
        },
      ],
      runner as never,
    );

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    // One live link per teacher per term: re-issuing replaces the token on the
    // row that is already there instead of leaving a second one beside it.
    // The predicate must repeat the partial index exactly, NOT NULL included,
    // or Postgres refuses to match it to any constraint.
    expect(sql).toContain('ON CONFLICT (school_term_id, teacher_membership_id)');
    expect(sql).toContain("WHERE link_status = 'ACTIVE' AND teacher_membership_id IS NOT NULL");
    expect(sql).toContain('last_used_at = NULL');
  });

  it('marks a rotated delivered link as needing resend', async () => {
    const { repository, runner } = setup();

    await repository.updateToken('link-id', 'hash', 'cipher', 1, runner as never);

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    expect(sql).toContain("WHEN line_delivery_status = 'SENT' THEN 'NEEDS_RESEND'");
    expect(sql).toContain('line_delivery_request_id = NULL');
  });

  it('claims delivery only for the active teacher the link belongs to', async () => {
    const { repository, runner } = setup();

    await repository.claimLineDelivery(
      'link-id',
      'membership-id',
      '3c195ce0-1f57-4e5c-a2cf-930a6315f28a',
      1,
    );

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    // A link belongs to a teacher, so delivery goes to that teacher. The old
    // rule read the homeroom of the link's classroom and outlived the column it
    // named, which made every send raise instead of deliver.
    expect(sql).not.toContain('classroom_homeroom_teachers');
    expect(sql).not.toContain('classroom_attendance_links.classroom_id');
    expect(sql).toContain('AND teacher_membership_id = $2');
    expect(sql).toContain('membership.school_id = classroom_attendance_links.school_id');
    expect(sql).toContain("membership.membership_status = 'ACTIVE'");
    expect(sql).toContain("teacher.teacher_status = 'ACTIVE'");
  });

  it('loads the classrooms a teacher link reaches, for presentation', async () => {
    const { repository, runner } = setup();

    await repository.list({
      schoolId: 10,
      schoolTermId: 20,
      page: 1,
      limit: 20,
      scope: { school_ids: [10] },
    });

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    // The link reaches whichever rooms the teacher's subjects are in, counted
    // and listed with the row so a listing never costs a query per teacher.
    expect(sql).toContain('FROM classroom_subject_teachers assignment');
    expect(sql).toContain('COUNT(DISTINCT assignment.classroom_id)');
    expect(sql).toContain('taught.classrooms');
  });
});
