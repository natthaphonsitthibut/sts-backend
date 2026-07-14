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
      listClassrooms: jest.fn().mockResolvedValue([CLASSROOM]),
      findTermSchoolId: jest.fn().mockResolvedValue(1001),
      createClassroom: jest.fn().mockResolvedValue(CLASSROOM),
      findClassroomById: jest.fn().mockResolvedValue(CLASSROOM),
      updateClassroom: jest.fn().mockResolvedValue(CLASSROOM),
      listTeachers: jest.fn().mockResolvedValue([]),
      isTeacherEligible: jest.fn().mockResolvedValue(true),
      createTeacherMembership: jest.fn(),
      findMembershipById: jest.fn(),
      updateTeacherMembership: jest.fn(),
      listAssignments: jest.fn().mockResolvedValue([]),
      createAssignment: jest.fn(),
      listRoster: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (operation: (runner: unknown) => Promise<unknown>) =>
        operation({ query: jest.fn() }),
      ),
    };
    const auditLog = { recordAtomic: jest.fn() };
    return {
      service: new SchoolStructureService(repository as never, auditLog as never),
      repository,
      auditLog,
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
    await expect(service.listTeachers(1001, TEACHER_ACCESS_ACTOR)).resolves.toEqual({ data: [] });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });

    await expect(
      service.createTeacherMembership({ schoolId: 1001, teacherUserId: 41 }, TEACHER_ACCESS_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only after server-side school scope validation', async () => {
    const { service, repository } = setup();

    await expect(service.listClassrooms(1001, 21, SCHOOL_ACTOR)).resolves.toMatchObject({
      data: [{ id: '11', schoolId: 1001, studentCount: 20 }],
    });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, { school_ids: [1001] });
    expect(repository.listClassrooms).toHaveBeenCalledWith(1001, 21);
  });

  it('denies missing permission, empty scope, narrow class scope, and cross-school probing', async () => {
    const { service, repository } = setup();
    await expect(
      service.listClassrooms(1001, undefined, { ...SCHOOL_ACTOR, permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listClassrooms(1001, undefined, { ...SCHOOL_ACTOR, data_scope: {} }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listClassrooms(1001, undefined, {
        ...SCHOOL_ACTOR,
        data_scope: { school_ids: [1001], room_ids: [1] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.isSchoolInScope.mockResolvedValue(false);
    await expect(service.listClassrooms(2002, undefined, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
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
          legacyRoomNumber: 1,
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

    await expect(service.listTeachers(2002, SCHOOL_ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.createTeacherMembership({ schoolId: 2002, teacherUserId: 41 }, SCHOOL_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createClassroom(
        { schoolTermId: 99, gradeLevelId: 423, roomCode: '1', legacyRoomNumber: 1 },
        SCHOOL_ACTOR,
      ),
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
    await expect(service.listRoster(99, SCHOOL_ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateTeacherMembership(
        31,
        { membershipStatus: 'INACTIVE', endedOn: '2026-07-14' },
        SCHOOL_ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
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
