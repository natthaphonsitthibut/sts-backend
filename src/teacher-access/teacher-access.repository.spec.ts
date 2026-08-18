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

  it('offers only timetable-backed subject assignments for attendance delegation', async () => {
    const { repository, runner } = createRepository();

    await repository.listAttendanceDelegationAssignments({
      schoolId: 10,
      schoolTermId: 21,
      classroomId: 41,
      attendanceDate: '2026-08-07',
    });

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[], boolean]>;
    const sql = calls[0]?.[0] ?? '';
    expect(sql).toContain("assignment.assignment_kind = 'SUBJECT'");
    expect(sql).toContain('timetable_slot.id IS NOT NULL');
    expect(sql).not.toContain("assignment.assignment_kind = 'HOMEROOM' OR");
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
        capabilities: ['SUBJECT_ATTENDANCE'],
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

  it('synchronizes an issued grant with current assignments and derived capabilities', async () => {
    const { repository, runner } = createRepository();

    await repository.syncGrantScopeFromAssignments(
      '11111111-1111-4111-8111-111111111111',
      '2026-08-07',
      runner as never,
    );

    const calls = runner.query.mock.calls as unknown as Array<[string, unknown[], boolean]>;
    expect(calls).toHaveLength(4);
    expect(calls[0][0]).toMatch(
      /DELETE FROM teacher_access_grant_assignments[\s\S]*assignment\.teacher_membership_id = access_grant\.teacher_membership_id/,
    );
    expect(calls[1][0]).toMatch(
      /INSERT INTO teacher_access_grant_assignments[\s\S]*ON CONFLICT \(grant_id, assignment_id\) DO NOTHING/,
    );
    expect(calls[2][0]).toContain('DELETE FROM teacher_access_grant_capabilities');
    expect(calls[3][0]).toMatch(/SUBJECT_ATTENDANCE[\s\S]*TEACHER_OBSERVATION/);
    expect(calls[3][0]).not.toContain('HOMEROOM_ATTENDANCE');
    expect(calls.map((call) => call[1])).toEqual([
      ['11111111-1111-4111-8111-111111111111', '2026-08-07'],
      ['11111111-1111-4111-8111-111111111111', '2026-08-07'],
      ['11111111-1111-4111-8111-111111111111'],
      ['11111111-1111-4111-8111-111111111111'],
    ]);
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
      expect.stringMatching(
        /teacher\.photo_storage_key AS teacher_photo_storage_key[\s\S]*ORDER BY[\s\S]*NOT_CREATED[\s\S]*DESC[\s\S]*LIMIT \$5 OFFSET \$6/,
      ),
      [10, 21, '2026-08-03', null, 20, 0, null],
      true,
    );
  });

  it('keeps delegation grants out of the teacher-link roster row', async () => {
    const { repository, runner } = createRepository();

    await repository.listTeacherLinkRoster({
      schoolId: 10,
      schoolTermId: 21,
      onDate: '2026-08-03',
      page: 1,
      limit: 20,
    });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /FROM teacher_access_grants access_grant[\s\S]*access_grant\.school_term_id = \$2[\s\S]*access_grant\.access_scope = 'FULL'[\s\S]*\) latest_grant ON TRUE/,
      ),
      [10, 21, '2026-08-03', null, 20, 0, null],
      true,
    );
  });

  it('keeps delegation grants out of the link delivery row', async () => {
    const { repository, runner } = createRepository();

    await repository.listGrantsForDelivery({ schoolId: 10, schoolTermId: 21 });

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /FROM teacher_access_grants access_grant[\s\S]*access_grant\.access_scope = 'FULL'[\s\S]*\) latest_grant ON TRUE/,
      ),
      [10, 21, null],
      true,
    );
  });

  it('still issues a term link for a teacher who only holds a delegation', async () => {
    const { repository, runner } = createRepository();

    await repository.listMembershipsNeedingGrant(
      { schoolId: 10, schoolTermId: 21, onDate: '2026-08-03' },
      runner as never,
    );

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /NOT EXISTS \([\s\S]*access_grant\.access_scope = 'FULL'[\s\S]*access_grant\.revoked_at IS NULL/,
      ),
      [10, 21, '2026-08-03', null],
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

  it('limits subject attendance slots to the assigned teacher', async () => {
    const { repository, runner } = createRepository();

    await repository.listAssignmentSlotsForDate(
      { classroomId: 41, subjectId: 7, teacherMembershipId: 12, isoDayOfWeek: 2 },
      runner as never,
    );

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /JOIN timetable_slot_teachers slot_teacher[\s\S]*slot_teacher\.teacher_membership_id = \$3[\s\S]*slot\.day_of_week = \$4/,
      ),
      [41, 7, 12, 2],
      true,
    );
  });

  it('stores a required problem category and description for a student comment', async () => {
    const { repository, runner } = createRepository();

    await repository.createStudentComment(
      {
        classroomId: 41,
        studentUuid: '00000000-0000-4000-8000-000000000001',
        problemCategory: 'ACADEMIC',
        problemDescription: 'เรียนไม่ทันบทเรียน',
        authoredByTeacherId: 12,
      },
      runner as never,
    );

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO classroom_student_comments[\s\S]*problem_category_code[\s\S]*problem_description[\s\S]*RETURNING id, problem_category_code, problem_description/,
      ),
      [41, '00000000-0000-4000-8000-000000000001', 'ACADEMIC', 'เรียนไม่ทันบทเรียน', 12],
      true,
    );
  });
});
