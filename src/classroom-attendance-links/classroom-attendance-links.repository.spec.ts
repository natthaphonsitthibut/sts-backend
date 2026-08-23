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
    expect(sql).toContain('school.id = ANY($3::int[])');
    expect(sql).toContain('classroom.grade_level_id = ANY($4::int[])');
    expect(sql).toContain('classroom.legacy_room_number = ANY($5::text[])');
    expect(sql).toContain('LIMIT $6 OFFSET $7');
    expect(sql).toContain('FROM school_classrooms classroom');
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
    expect(calls[0][0]).toContain('membership.id IS NULL');
    expect(calls[1][0]).toContain('LEFT JOIN classroom_attendance_links link');
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

  it('reactivates only an inactive classroom link and rotates its token atomically', async () => {
    const { repository, runner } = setup([{ id: 'link-id' }]);

    await repository.upsertLinks(
      [
        {
          schoolId: 10,
          schoolTermId: 20,
          classroomId: 30,
          tokenHash: 'b'.repeat(64),
          tokenEncrypted: 'v1:cipher',
          actorId: 1,
        },
      ],
      runner as never,
    );

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    expect(sql).toContain('ON CONFLICT (classroom_id) DO UPDATE');
    expect(sql).toContain("WHERE classroom_attendance_links.link_status = 'INACTIVE'");
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

  it('claims delivery only for the current active homeroom membership', async () => {
    const { repository, runner } = setup();

    await repository.claimLineDelivery(
      'link-id',
      'membership-id',
      '3c195ce0-1f57-4e5c-a2cf-930a6315f28a',
      1,
    );

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[] | undefined]>;
    const sql = calls[0][0];
    expect(sql).toContain('FROM classroom_homeroom_teachers homeroom');
    expect(sql).toContain("membership.membership_status = 'ACTIVE'");
    expect(sql).toContain("teacher.teacher_status = 'ACTIVE'");
    expect(sql).toContain('homeroom.teacher_membership_id = $2');
  });
});
