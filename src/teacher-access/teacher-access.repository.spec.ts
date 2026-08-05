import { TeacherAccessRepository } from './teacher-access.repository';

describe('TeacherAccessRepository', () => {
  function createRepository() {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ records: [], affected: 0 }),
    };
    const dataSource = { createQueryRunner: jest.fn(() => runner) };
    return {
      repository: new TeacherAccessRepository(dataSource as never),
      runner,
    };
  }

  it('uses the caller-supplied Bangkok date for active assignment options', async () => {
    const { repository, runner } = createRepository();

    await repository.listAssignmentOptions({
      schoolId: 10,
      schoolTermId: 21,
      teacherMembershipIds: [12],
      onDate: '2026-07-15',
    });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /classroom\.classroom_status = 'ACTIVE'[\s\S]*effective_on <= \$4::date[\s\S]*effective_until >= \$4::date/,
      ),
      [10, 21, [12], '2026-07-15'],
      true,
    );
  });

  it('persists assignment scope columns from canonical assignment and classroom rows', async () => {
    const { repository, runner } = createRepository();
    runner.query
      .mockResolvedValueOnce({
        records: [{ id: '11111111-1111-4111-8111-111111111111' }],
        affected: 1,
      })
      .mockResolvedValue({ records: [], affected: 0 });

    await repository.createGrant(
      {
        teacherMembershipId: 12,
        schoolId: 10,
        schoolTermId: 21,
        tokenHash: 'a'.repeat(64),
        tokenEncrypted: 'v1:cipher',
        stepUpPolicy: 'EMAIL_OTP',
        issuedBy: 1,
        expiresAt: new Date('2026-12-31T16:59:59.999Z'),
        capabilities: ['HOMEROOM_ATTENDANCE'],
        assignmentIds: [31],
      },
      runner as never,
    );

    const queryCalls = runner.query.mock.calls as unknown as Array<
      [string, unknown[] | undefined, boolean]
    >;
    const assignmentInsert = queryCalls[2]?.[0] ?? '';
    expect(assignmentInsert).toContain('grant_id, assignment_id, teacher_membership_id,');
    expect(assignmentInsert).toContain('school_id, school_term_id, classroom_id');
    expect(assignmentInsert).toContain(
      'JOIN classroom_teacher_assignments assignment ON assignment.id = requested.assignment_id',
    );
  });

  it('locks grant use and selects every fail-closed account/school/term status', async () => {
    const { repository, runner } = createRepository();

    await repository.findGrantByTokenHashForUpdate('a'.repeat(64), runner as never);

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /teacher\.teacher_status AS teacher_status[\s\S]*membership\.deleted_at AS membership_deleted_at[\s\S]*school\.school_status[\s\S]*term\.deleted_at AS term_deleted_at[\s\S]*FROM teacher_access_grants access_grant[\s\S]*FOR UPDATE OF access_grant/,
      ),
      ['a'.repeat(64)],
      true,
    );
  });

  it('sorts the teacher-link roster before pagination', async () => {
    const { repository, runner } = createRepository();

    await repository.listTeacherLinkRoster({
      schoolId: 10,
      schoolTermId: 21,
      onDate: '2026-08-03',
      sortBy: 'linkStatus',
      sortOrder: 'desc',
      page: 1,
      limit: 20,
    });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/ORDER BY[\s\S]*NOT_CREATED[\s\S]*DESC[\s\S]*LIMIT \$5 OFFSET \$6/),
      [10, 21, '2026-08-03', null, 20, 0, null],
      true,
    );
  });

  it('narrows the teacher-link roster to teachers who verified LINE', async () => {
    const { repository, runner } = createRepository();

    await repository.listTeacherLinkRoster({
      schoolId: 10,
      schoolTermId: 21,
      onDate: '2026-08-03',
      lineStatus: 'VERIFIED',
      page: 1,
      limit: 20,
    });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/line_account.id IS NOT NULL/),
      [10, 21, '2026-08-03', null, 20, 0, 'VERIFIED'],
      true,
    );
  });

  it('filters and sorts attendance history before pagination', async () => {
    const { repository, runner } = createRepository();

    await repository.listAttendanceHistory(
      {
        classroomId: 41,
        sessionKind: 'DAILY',
        subjectId: null,
        search: 'ครูหนึ่ง',
        attendanceDate: '2026-08-03',
        sortBy: 'absent',
        sortOrder: 'asc',
        page: 2,
        limit: 20,
      },
      runner as never,
    );

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /FROM history_rows[\s\S]*recorded_by[\s\S]*attendance_date::date[\s\S]*ORDER BY absent_count ASC[\s\S]*LIMIT \$6 OFFSET \$7/,
      ),
      [41, 'DAILY', null, '%ครูหนึ่ง%', '2026-08-03', 20, 20],
      true,
    );
  });
});
