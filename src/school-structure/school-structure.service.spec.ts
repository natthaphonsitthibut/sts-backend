import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchoolStructureService } from './school-structure.service';

const SCHOOL_ACTOR = {
  id: 7,
  username: 'school-director',
  roles: ['DIRECTOR'],
  permissions: ['manage-school-structure'],
  data_scope: { school_ids: [1001] },
};

const TEACHER_ACCESS_ACTOR = {
  ...SCHOOL_ACTOR,
  roles: [],
  permissions: ['manage-teacher-access'],
};

const IMPORT_ACTOR = {
  ...SCHOOL_ACTOR,
  roles: [],
  permissions: ['import-data'],
};

const CLASSROOM = {
  id: '11',
  school_term_id: '21',
  school_id: 1001,
  academic_year: 2569,
  semester: 1,
  grade_level_id: 423,
  grade_label: 'ม.6',
  legacy_room_number: 1,
  room_code: '1',
  room_name: 'ห้อง 1',
  classroom_status: 'ACTIVE',
  card_cover_color: '#4F86E8',
  cover_image_storage_key: null,
  cover_image_position_x: 50,
  cover_image_position_y: 50,
  cover_image_scale: '1.00',
  updated_at: '2026-08-01T00:00:00.000Z',
  is_favorite: false,
  favorited_at: null,
  homeroom_teacher_name: 'ครูทดสอบ',
  student_count: 20,
};

describe('SchoolStructureService', () => {
  function setup() {
    const repository = {
      listScopedSchools: jest.fn().mockResolvedValue([
        {
          id: 1001,
          name: 'โรงเรียนทดสอบ',
          province: 'เชียงใหม่',
          district: 'เมืองเชียงใหม่',
          sub_district: 'สุเทพ',
        },
      ]),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      listClassrooms: jest.fn().mockResolvedValue({
        rows: [CLASSROOM],
        totalCount: 1,
        teacherCount: 1,
        studentCount: 20,
      }),
      listClassroomOptions: jest.fn().mockResolvedValue([]),
      findTermSchoolId: jest.fn().mockResolvedValue(1001),
      createClassroom: jest.fn().mockResolvedValue(CLASSROOM),
      findClassroomById: jest.fn().mockResolvedValue(CLASSROOM),
      updateClassroom: jest.fn().mockResolvedValue(CLASSROOM),
      getClassroomUsage: jest.fn().mockResolvedValue({ studentCount: 0, assignmentCount: 0 }),
      softDeleteClassroom: jest.fn().mockResolvedValue(undefined),
      setClassroomFavorite: jest.fn().mockResolvedValue(undefined),
      updateClassroomPresentation: jest.fn().mockResolvedValue(undefined),
      listTeachers: jest.fn().mockResolvedValue({ rows: [], totalCount: 0, activeCount: 0 }),
      listTeacherCandidates: jest.fn().mockResolvedValue([]),
      listTeacherOptions: jest.fn().mockResolvedValue([]),
      isTeacherEligible: jest.fn().mockResolvedValue(true),
      createTeacherMembership: jest.fn(),
      findMembershipById: jest.fn(),
      updateTeacherMembership: jest.fn(),
      listAssignments: jest.fn().mockResolvedValue([]),
      createAssignment: jest.fn(),
      listRoster: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      createStudentComment: jest.fn().mockResolvedValue({
        id: '91',
        comment_text: 'ควรติดตามการส่งงาน',
        created_at: new Date('2026-08-01T03:00:00.000Z'),
      }),
      listClassroomDailyAttendance: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      listClassroomStudentAttendance: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      listStudentAttendanceDays: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      withTransaction: jest.fn(async (operation: (runner: unknown) => Promise<unknown>) =>
        operation({ query: jest.fn() }),
      ),
    };
    const auditLog = { recordAtomic: jest.fn() };
    const storage = {
      kind: 'local',
      save: jest.fn().mockResolvedValue(undefined),
      saveStream: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue(null),
      open: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new SchoolStructureService(repository as never, auditLog as never, storage as never),
      repository,
      auditLog,
      storage,
    };
  }

  it('lists active schools using only the authenticated data scope', async () => {
    const { service, repository } = setup();

    await expect(service.listSchools(SCHOOL_ACTOR)).resolves.toMatchObject({
      data: [{ id: 1001, name: 'โรงเรียนทดสอบ', subDistrict: 'สุเทพ' }],
    });
    expect(repository.listScopedSchools).toHaveBeenCalledWith({ school_ids: [1001] });
  });

  it('allows teacher-access administrators to read schools and teachers only', async () => {
    const { service, repository } = setup();

    await expect(service.listSchools(TEACHER_ACCESS_ACTOR)).resolves.toMatchObject({
      data: [{ id: 1001 }],
    });
    await expect(
      service.listTeachers({ schoolId: 1001 }, TEACHER_ACCESS_ACTOR),
    ).resolves.toMatchObject({ data: [], meta: { totalCount: 0 } });
    await expect(
      service.listTeacherOptions({ schoolId: 1001 }, TEACHER_ACCESS_ACTOR),
    ).resolves.toEqual({ data: [] });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });

    await expect(
      service.createTeacherMembership({ schoolId: 1001, teacherUserId: 41 }, TEACHER_ACCESS_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only after server-side school scope validation', async () => {
    const { service, repository } = setup();

    await expect(
      service.listClassrooms({ schoolId: 1001, termId: 21 }, SCHOOL_ACTOR),
    ).resolves.toMatchObject({
      data: [{ id: '11', schoolId: 1001, studentCount: 20 }],
      meta: { totalCount: 1 },
      summary: { classroomCount: 1, teacherCount: 1, studentCount: 20 },
    });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });
    expect(repository.listClassrooms).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1001, userId: 7, termId: 21, page: 1, limit: 20 }),
    );
  });

  it('keeps favorites user-specific and validates school scope before changing them', async () => {
    const { service, repository } = setup();

    await expect(service.setClassroomFavorite(11, true, SCHOOL_ACTOR)).resolves.toEqual({
      data: { classroomId: '11', isFavorite: true },
    });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });
    expect(repository.setClassroomFavorite).toHaveBeenCalledWith(7, 11, true);

    repository.isSchoolInScope.mockResolvedValueOnce(false);
    await expect(service.setClassroomFavorite(11, false, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates only classroom presentation fields and returns the complete card shape', async () => {
    const { service, repository, auditLog } = setup();
    const updatedClassroom = {
      ...CLASSROOM,
      card_cover_color: '#3CCF91',
      cover_image_position_x: 25,
      cover_image_position_y: 75,
      cover_image_scale: '1.50',
    };
    repository.findClassroomById
      .mockResolvedValueOnce(CLASSROOM)
      .mockResolvedValueOnce(CLASSROOM)
      .mockResolvedValueOnce(updatedClassroom);

    await expect(
      service.updateClassroomPresentation(
        11,
        {
          cardCoverColor: '#3CCF91',
          coverImagePositionX: 25,
          coverImagePositionY: 75,
          coverImageScale: 1.5,
        },
        SCHOOL_ACTOR,
      ),
    ).resolves.toMatchObject({
      data: {
        cardCoverColor: '#3CCF91',
        coverImagePositionX: 25,
        coverImagePositionY: 75,
        coverImageScale: 1.5,
        homeroomTeacherName: 'ครูทดสอบ',
      },
    });
    expect(repository.updateClassroomPresentation).toHaveBeenCalledWith(
      11,
      {
        cardCoverColor: '#3CCF91',
        coverImageStorageKey: null,
        coverImagePositionX: 25,
        coverImagePositionY: 75,
        coverImageScale: 1.5,
      },
      7,
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledTimes(1);
    const auditCall = auditLog.recordAtomic.mock.calls[0] as unknown as [
      { metadata: { changedFields: string[] } },
      unknown,
    ];
    expect(auditCall[0].metadata.changedFields).toEqual(['cardCoverColor', 'coverImageFraming']);
  });

  it('allows import actors to read classrooms within their server-side school scope', async () => {
    const { service, repository } = setup();

    await expect(
      service.listClassrooms({ schoolId: 1001, termId: 21 }, IMPORT_ACTOR),
    ).resolves.toMatchObject({
      data: [{ id: '11', schoolId: 1001 }],
    });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });
  });

  it('uses the selected school context for filtered teacher and roster tables', async () => {
    const { service, repository } = setup();

    await service.listTeachers(
      {
        schoolId: 1001,
        termId: 21,
        gradeLevelId: 423,
        classroomId: 11,
        assignedToFilteredClassrooms: true,
      },
      SCHOOL_ACTOR,
    );
    await service.listRoster(
      { schoolId: 1001, termId: 21, gradeLevelId: 423, classroomId: 11 },
      SCHOOL_ACTOR,
    );

    expect(repository.listTeachers).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: 1001,
        termId: 21,
        gradeLevelId: 423,
        classroomId: 11,
        assignedToFilteredClassrooms: true,
      }),
    );
    expect(repository.listRoster).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: 1001,
        termId: 21,
        gradeLevelId: 423,
        classroomId: 11,
      }),
    );
  });

  it('returns the configured badge style with each student status', async () => {
    const { service, repository } = setup();
    repository.listRoster.mockResolvedValueOnce({
      rows: [
        {
          student_uuid: '00000000-0000-4000-8000-000000000001',
          student_number: '66000001',
          risk_tier: 'WATCH',
          risk_severity: 1,
          teacher_comment: 'ควรติดตามการส่งงาน',
          first_name: 'กานต์',
          last_name: 'ศึกษา',
          student_status_code: 1,
          student_status_label: 'กำลังศึกษา',
          student_status_badge_variant: 'success',
          classroom_id: '11',
          grade_label: 'ม.6',
          room_code: '1',
        },
      ],
      totalCount: 1,
    });

    await expect(
      service.listRoster({ schoolId: 1001, classroomId: 11 }, SCHOOL_ACTOR),
    ).resolves.toMatchObject({
      data: [
        {
          studentNumber: '66000001',
          riskTier: 'WATCH',
          riskSeverity: 1,
          teacherComment: 'ควรติดตามการส่งงาน',
          studentStatusLabel: 'กำลังศึกษา',
          studentStatusBadgeVariant: 'success',
        },
      ],
    });
  });

  it('appends a scoped classroom comment and records an audit without comment content', async () => {
    const { service, repository, auditLog } = setup();
    const studentUuid = '00000000-0000-4000-8000-000000000001';

    await expect(
      service.createStudentComment(
        11,
        studentUuid,
        { commentText: 'ควรติดตามการส่งงาน' },
        SCHOOL_ACTOR,
      ),
    ).resolves.toMatchObject({
      data: { id: '91', studentUuid, teacherComment: 'ควรติดตามการส่งงาน' },
    });
    expect(repository.createStudentComment).toHaveBeenCalledWith(
      11,
      studentUuid,
      'ควรติดตามการส่งงาน',
      SCHOOL_ACTOR.id,
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'classroom_student_comments',
        targetId: '91',
        metadata: {
          op: 'create',
          schoolId: 1001,
          classroomId: 11,
          studentUuid,
          commentLength: 'ควรติดตามการส่งงาน'.length,
        },
      }),
      expect.anything(),
    );
    expect(JSON.stringify(auditLog.recordAtomic.mock.calls[0])).not.toContain('ควรติดตาม');
  });

  it('rejects a comment when the student is not enrolled in the scoped classroom', async () => {
    const { service, repository } = setup();
    repository.createStudentComment.mockResolvedValueOnce(null);

    await expect(
      service.createStudentComment(
        11,
        '00000000-0000-4000-8000-000000000099',
        { commentText: 'ทดสอบ' },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns scoped daily attendance summaries with paginated counts', async () => {
    const { service, repository } = setup();
    repository.listClassroomDailyAttendance.mockResolvedValueOnce({
      rows: [
        {
          attendance_date: '2026-07-14',
          recorded_by: 'วิภาวี สายสมร',
          present_count: 28,
          late_count: 5,
          leave_count: 0,
          absent_count: 2,
        },
      ],
      totalCount: 1,
    });

    await expect(
      service.listClassroomAttendanceHistory(11, { view: 'DAILY' }, SCHOOL_ACTOR),
    ).resolves.toMatchObject({
      data: [
        {
          date: '2026-07-14',
          recordedBy: 'วิภาวี สายสมร',
          presentCount: 28,
          lateCount: 5,
          leaveCount: 0,
          absentCount: 2,
        },
      ],
      meta: { totalCount: 1 },
    });
    expect(repository.listClassroomDailyAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 11,
        page: 1,
        sortBy: 'date',
        sortDirection: 'desc',
      }),
    );
  });

  it('passes an inclusive date range to student attendance history', async () => {
    const { service, repository } = setup();
    const studentUuid = '00000000-0000-4000-8000-000000000001';

    await expect(
      service.listClassroomAttendanceHistory(
        11,
        {
          view: 'STUDENT',
          studentUuid,
          dateFrom: '2026-07-01',
          dateTo: '2026-07-31',
        },
        SCHOOL_ACTOR,
      ),
    ).resolves.toMatchObject({ data: [], meta: { totalCount: 0 } });
    expect(repository.listStudentAttendanceDays).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 11,
        studentUuid,
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        sortBy: 'date',
        sortDirection: 'desc',
      }),
    );
  });

  it('rejects an attendance range whose start is after its end', async () => {
    const { service, repository } = setup();

    await expect(
      service.listClassroomAttendanceHistory(
        11,
        {
          view: 'STUDENT',
          studentUuid: '00000000-0000-4000-8000-000000000001',
          dateFrom: '2026-07-31',
          dateTo: '2026-07-01',
        },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.listStudentAttendanceDays).not.toHaveBeenCalled();
  });

  it('rejects a roster query without a school or classroom context', async () => {
    const { service } = setup();
    await expect(service.listRoster({}, SCHOOL_ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies missing permission, empty scope, narrow class scope, and cross-school probing', async () => {
    const { service, repository } = setup();
    await expect(
      service.listClassrooms({ schoolId: 1001 }, { ...SCHOOL_ACTOR, permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listClassrooms({ schoolId: 1001 }, { ...SCHOOL_ACTOR, data_scope: {} }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listClassrooms(
        { schoolId: 1001 },
        {
          ...SCHOOL_ACTOR,
          data_scope: { school_ids: [1001], room_ids: [1] },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.isSchoolInScope.mockResolvedValue(false);
    await expect(service.listClassrooms({ schoolId: 2002 }, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a classroom under the term school and records atomic audit', async () => {
    const { service, repository, auditLog } = setup();

    await expect(
      service.createClassroom(
        {
          schoolTermId: 21,
          gradeLevelId: 423,
          roomCode: '1',
          roomName: 'ห้อง 1',
        },
        SCHOOL_ACTOR,
      ),
    ).resolves.toMatchObject({ data: { id: '11', schoolId: 1001 } });
    expect(repository.createClassroom).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1001, schoolTermId: 21, actorId: 7 }),
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'school_classrooms', targetId: '11' }),
      expect.anything(),
    );
  });

  it('fails closed for cross-school create, update, assignment, and roster probes', async () => {
    const { service, repository } = setup();
    repository.isSchoolInScope.mockResolvedValue(false);
    repository.findTermSchoolId.mockResolvedValue(2002);
    repository.findClassroomById.mockResolvedValue({ ...CLASSROOM, school_id: 2002 });
    repository.findMembershipById.mockResolvedValue({
      id: '31',
      school_id: 2002,
      teacher_user_id: 41,
      username: 'teacher-b',
      display_name: 'Teacher B',
      membership_status: 'ACTIVE',
      started_on: '2026-07-01',
      ended_on: null,
    });

    await expect(service.listTeachers({ schoolId: 2002 }, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.createTeacherMembership({ schoolId: 2002, teacherUserId: 41 }, SCHOOL_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createClassroom({ schoolTermId: 99, gradeLevelId: 423, roomCode: '1' }, SCHOOL_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateClassroom(99, { roomName: 'ห้อง B' }, SCHOOL_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listAssignments(99, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.createAssignment(
        { classroomId: 99, teacherMembershipId: 31, assignmentKind: 'HOMEROOM' },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listRoster({ classroomId: 99 }, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.updateTeacherMembership(
        31,
        { membershipStatus: 'INACTIVE', endedOn: '2026-07-14' },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks a grade change while students are enrolled but allows other edits', async () => {
    const { service, repository } = setup();
    repository.getClassroomUsage.mockResolvedValue({ studentCount: 5, assignmentCount: 1 });

    await expect(
      service.updateClassroom(11, { gradeLevelId: 500 }, SCHOOL_ACTOR as never),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      service.updateClassroom(11, { roomCode: '2' }, SCHOOL_ACTOR as never),
    ).resolves.toMatchObject({ data: { id: '11' } });
    expect(repository.updateClassroom).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ roomCode: '2', roomNumber: 2 }),
      SCHOOL_ACTOR.id,
      expect.anything(),
    );
  });

  it.each(['ก', '0', '2147483648'])(
    'rejects invalid numeric classroom code %s before persistence',
    async (roomCode) => {
      const { service, repository } = setup();

      await expect(
        service.createClassroom({ schoolTermId: 21, gradeLevelId: 423, roomCode }, SCHOOL_ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createClassroom).not.toHaveBeenCalled();
    },
  );

  it('deletes only an unused classroom and records atomic audit', async () => {
    const { service, repository, auditLog } = setup();
    repository.getClassroomUsage.mockResolvedValueOnce({ studentCount: 3, assignmentCount: 0 });
    await expect(service.deleteClassroom(11, SCHOOL_ACTOR as never)).rejects.toMatchObject({
      status: 409,
    });

    repository.getClassroomUsage.mockResolvedValueOnce({ studentCount: 0, assignmentCount: 2 });
    await expect(service.deleteClassroom(11, SCHOOL_ACTOR as never)).rejects.toMatchObject({
      status: 409,
    });
    expect(repository.softDeleteClassroom).not.toHaveBeenCalled();

    repository.getClassroomUsage.mockResolvedValueOnce({ studentCount: 0, assignmentCount: 0 });
    await expect(service.deleteClassroom(11, SCHOOL_ACTOR as never)).resolves.toEqual({
      data: { deleted: true },
    });
    expect(repository.softDeleteClassroom).toHaveBeenCalledWith(
      11,
      SCHOOL_ACTOR.id,
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'school_classrooms',
        metadata: { op: 'delete', schoolId: 1001 },
      }),
      expect.anything(),
    );
  });

  it('requires export permission and records classroom exports atomically', async () => {
    const { service, auditLog } = setup();
    const request = {
      exportScope: 'ROSTER' as const,
      format: 'xlsx' as const,
      columns: ['studentNumber', 'name'],
    };

    await expect(
      service.authorizeClassroomExport(11, request, SCHOOL_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.authorizeClassroomExport(11, request, {
        ...SCHOOL_ACTOR,
        permissions: ['manage-school-structure', 'export-data'],
      }),
    ).resolves.toEqual({ data: { authorized: true } });
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLASSROOM_DATA_EXPORT',
        targetType: 'school_classrooms',
        targetId: '11',
        metadata: {
          schoolId: 1001,
          exportScope: 'ROSTER',
          format: 'xlsx',
          columns: ['studentNumber', 'name'],
        },
      }),
      expect.anything(),
    );
  });

  it('rejects an assignment with an invalid effective date range', async () => {
    const { service } = setup();
    await expect(
      service.createAssignment(
        {
          classroomId: 11,
          teacherMembershipId: 31,
          assignmentKind: 'HOMEROOM',
          effectiveOn: '2026-07-20',
          effectiveUntil: '2026-07-19',
        },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
