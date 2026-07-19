import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { AuthenticatedRequestUser } from '../auth';
import { StudentObservationsRepository } from './student-observations.repository';
import { StudentObservationsService } from './student-observations.service';
import type {
  ObservationAssignmentRow,
  ObservationEnrollmentRow,
  StudentObservationRow,
} from './student-observations.types';

const STUDENT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUNNER = {} as QueryRunner;

const MANAGER: AuthenticatedRequestUser = {
  id: 1,
  username: 'director',
  roles: ['DIRECTOR'],
  permissions: ['manage-student-observations'],
  data_scope: { school_ids: [10] },
};

const TEACHER: AuthenticatedRequestUser = {
  id: 44,
  username: 'teacher.one',
  roles: ['TEACHER'],
  permissions: ['student-observations'],
  data_scope: { school_ids: [10], grade_levels: [11], room_ids: ['1'] },
};

const ENROLLMENT: ObservationEnrollmentRow = {
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
};

const ASSIGNMENT: ObservationAssignmentRow = {
  assignment_id: '31',
  teacher_membership_id: '12',
  teacher_user_id: 44,
  school_id: 10,
  school_term_id: '21',
  classroom_id: '41',
  subject_id: 8,
  assignment_kind: 'SUBJECT',
};

const OBSERVATION: StudentObservationRow = {
  id: '51',
  student_uuid: STUDENT_UUID,
  school_id: 10,
  author_kind: 'USER',
  author_user_id: 44,
  author_username: 'teacher.one',
  author_display_name: 'ครู หนึ่ง',
  author_teacher_membership_id: '12',
  source_teacher_access_grant_id: null,
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
  observed_at: new Date('2026-07-14T08:00:00.000Z'),
  revision_number: 1,
  created_at: new Date('2026-07-14T08:00:00.000Z'),
  updated_at: new Date('2026-07-14T08:00:00.000Z'),
  tags: [{ id: '1', code: 'MISSING_ASSIGNMENTS', labelTh: 'ไม่ส่งงาน' }],
  total_count: 1,
};

function createHarness() {
  const repository = {
    withTransaction: jest.fn(
      async (operation: (queryRunner: QueryRunner) => Promise<unknown>) => await operation(RUNNER),
    ),
    isEnrollmentInScope: jest.fn().mockResolvedValue(true),
    isTimetableSlotForEnrollment: jest.fn().mockResolvedValue(true),
    findEnrollment: jest.fn().mockResolvedValue(ENROLLMENT),
    findActiveAssignment: jest.fn().mockResolvedValue(ASSIGNMENT),
    findActorAssignment: jest.fn().mockResolvedValue(ASSIGNMENT),
    findActorAssignmentForTimetableSlot: jest.fn().mockResolvedValue(ASSIGNMENT),
    resolveCatalog: jest.fn().mockResolvedValue({
      dimension: {
        id: '2',
        code: 'LEARNING',
        label_th: 'การเรียน',
        requires_comment: false,
        is_active: true,
        sort_order: 20,
      },
      tags: [
        {
          id: '1',
          code: 'MISSING_ASSIGNMENTS',
          label_th: 'ไม่ส่งงาน',
          observation_dimension_id: '2',
          dimension_code: 'LEARNING',
          requires_comment: false,
          is_active: true,
          sort_order: 10,
        },
      ],
    }),
    createObservation: jest.fn().mockResolvedValue(OBSERVATION),
    listObservations: jest.fn().mockResolvedValue([OBSERVATION]),
    listTaskLinkObservations: jest.fn().mockResolvedValue([OBSERVATION]),
    findObservationById: jest.fn().mockResolvedValue(OBSERVATION),
    updateObservation: jest
      .fn()
      .mockResolvedValue({ ...OBSERVATION, revision_number: 2, comment: 'แก้ไขแล้ว' }),
    listRevisions: jest.fn().mockResolvedValue([]),
    listCatalog: jest.fn().mockResolvedValue({ dimensions: [], tags: [] }),
    updateDimension: jest.fn(),
    updateTag: jest.fn(),
  };
  const auditLog = {
    recordAtomic: jest.fn().mockResolvedValue(undefined),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const grantContext = {
    grantId: '11111111-1111-4111-8111-111111111111',
    teacherMembershipId: '12',
    teacherUserId: 44,
    teacherUsername: 'teacher.one',
    teacherDisplayName: 'ครู หนึ่ง',
    schoolId: 10,
    schoolName: 'โรงเรียนหนึ่ง',
    schoolTermId: '21',
    academicYear: 2569,
    semester: 1,
    assignmentId: '31',
    classroomId: '41',
    subjectId: 8,
    capabilities: ['TEACHER_OBSERVATION'] as const,
  };
  const teacherAccess = {
    withActiveGrantContext: jest.fn(
      async (
        _token: string,
        _options: unknown,
        operation: (context: typeof grantContext, queryRunner: QueryRunner) => Promise<unknown>,
      ) => await operation(grantContext, RUNNER),
    ),
  };
  const taskAccess = {
    getTaskByToken: jest.fn().mockResolvedValue({
      task_type: 'ATTENDANCE',
      auth_required: false,
      link_id: '22222222-2222-4222-8222-222222222222',
      target_school_id: 10,
      target_grade: 'ป.1',
      target_room: '1',
      assigned_to_name: 'ผู้ช่วยเช็คชื่อ',
    }),
  };
  const taskRepository = {
    findTaskLinkById: jest.fn().mockResolvedValue({ created_by: 77 }),
    listLinkedTimetableSlots: jest.fn().mockResolvedValue([{ id: 901 }]),
    listTaskStudents: jest.fn().mockResolvedValue([{ id: STUDENT_UUID }]),
  };
  const service = new StudentObservationsService(
    repository as unknown as StudentObservationsRepository,
    auditLog as never,
    teacherAccess as never,
    taskAccess as never,
    taskRepository as never,
  );
  return { service, repository, auditLog, teacherAccess, taskAccess, taskRepository };
}

describe('StudentObservationsService', () => {
  it('creates a NOTE without a comment and persists first-class tags/revision input', async () => {
    const { service, repository, auditLog } = createHarness();

    await expect(
      service.create(
        STUDENT_UUID,
        {
          assignmentId: 31,
          dimensionCode: 'LEARNING',
          concernLevel: 'NOTE',
          tagCodes: ['MISSING_ASSIGNMENTS'],
        },
        TEACHER,
      ),
    ).resolves.toMatchObject({ data: { id: '51', studentTermId: STUDENT_UUID } });
    expect(repository.createObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUuid: STUDENT_UUID,
        authorKind: 'USER',
        authorUserId: 44,
        sourceAssignmentId: 31,
        comment: null,
        behaviorTagIds: [1],
      }),
      RUNNER,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_OBSERVATION_CREATE' }),
      RUNNER,
    );
  });

  it.each([
    ['CONCERN', false],
    ['NOTE', true],
  ] as const)('requires a comment for %s or catalog OTHER semantics', async (level, other) => {
    const { service, repository } = createHarness();
    if (other) {
      repository.resolveCatalog.mockResolvedValue({
        dimension: {
          id: '7',
          code: 'OTHER',
          label_th: 'อื่น ๆ',
          requires_comment: true,
          is_active: true,
          sort_order: 70,
        },
        tags: [],
      });
    }

    await expect(
      service.create(
        STUDENT_UUID,
        {
          assignmentId: 31,
          dimensionCode: other ? 'OTHER' : 'LEARNING',
          concernLevel: level,
          tagCodes: other ? [] : ['MISSING_ASSIGNMENTS'],
        },
        TEACHER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createObservation).not.toHaveBeenCalled();
  });

  it('fails closed for cross-school managers and mismatched teacher assignments', async () => {
    const { service, repository } = createHarness();
    repository.isEnrollmentInScope.mockResolvedValue(false);
    await expect(service.list(STUDENT_UUID, {}, MANAGER)).rejects.toBeInstanceOf(NotFoundException);

    repository.isEnrollmentInScope.mockResolvedValue(true);
    repository.findActiveAssignment.mockResolvedValue({ ...ASSIGNMENT, teacher_user_id: 99 });
    await expect(
      service.create(
        STUDENT_UUID,
        {
          assignmentId: 31,
          dimensionCode: 'LEARNING',
          concernLevel: 'NOTE',
          tagCodes: ['MISSING_ASSIGNMENTS'],
        },
        TEACHER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a logged-in teacher to observe an in-scope student without an assignment', async () => {
    const { service, repository } = createHarness();
    repository.findActorAssignment.mockResolvedValue(null);
    repository.findActorAssignmentForTimetableSlot.mockResolvedValue(null);

    await expect(service.list(STUDENT_UUID, {}, TEACHER)).resolves.toMatchObject({
      data: [expect.objectContaining({ studentTermId: STUDENT_UUID })],
    });
    await expect(
      service.create(
        STUDENT_UUID,
        {
          timetableSlotId: 901,
          dimensionCode: 'LEARNING',
          concernLevel: 'NOTE',
          tagCodes: ['MISSING_ASSIGNMENTS'],
        },
        TEACHER,
      ),
    ).resolves.toMatchObject({ data: { id: '51' } });
    expect(repository.isEnrollmentInScope).toHaveBeenCalledWith(STUDENT_UUID, TEACHER.data_scope);
    expect(repository.isTimetableSlotForEnrollment).toHaveBeenCalledWith(901, ENROLLMENT, RUNNER);
    expect(repository.createObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAssignmentId: null,
        sourceTimetableSlotId: 901,
      }),
      RUNNER,
    );
  });

  it('denies a logged-in teacher outside data scope even when assigned to the student', async () => {
    const { service, repository } = createHarness();
    repository.findActorAssignment.mockResolvedValue(ASSIGNMENT);
    repository.isEnrollmentInScope.mockResolvedValue(false);

    await expect(service.list(STUDENT_UUID, {}, TEACHER)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findActorAssignment).not.toHaveBeenCalled();
    expect(repository.listObservations).not.toHaveBeenCalled();
  });

  it('denies raw comments to an executive even if the permission is explicitly granted', async () => {
    const { service } = createHarness();
    await expect(
      service.list(
        STUDENT_UUID,
        {},
        {
          ...MANAGER,
          roles: ['EXECUTIVE'],
          permissions: ['manage-student-observations'],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses optimistic revision locking before an update', async () => {
    const { service, repository } = createHarness();
    await expect(
      service.update(STUDENT_UUID, '51', { expectedRevision: 9, comment: 'แก้ไขแล้ว' }, TEACHER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateObservation).not.toHaveBeenCalled();
  });

  it('allows a scoped manager to revise history after the source assignment becomes inactive', async () => {
    const { service, repository } = createHarness();
    repository.findActiveAssignment.mockResolvedValue(null);

    await expect(
      service.update(
        STUDENT_UUID,
        '51',
        { expectedRevision: 1, comment: 'แก้ไขโดยผู้รับผิดชอบโรงเรียน' },
        MANAGER,
      ),
    ).resolves.toMatchObject({ data: { revision: 2 } });
    expect(repository.updateObservation).toHaveBeenCalledWith(
      '51',
      expect.objectContaining({ sourceAssignmentId: 31, authorUserId: 1 }),
      2,
      1,
      RUNNER,
    );
  });

  it('binds teacher-access creation to capability, assignment, enrollment and grant provenance', async () => {
    const { service, repository, teacherAccess } = createHarness();
    await service.createWithTeacherAccess(
      'token-value-that-is-at-least-thirty-two-characters',
      STUDENT_UUID,
      {
        assignmentId: 31,
        dimensionCode: 'LEARNING',
        concernLevel: 'NOTE',
        tagCodes: ['MISSING_ASSIGNMENTS'],
      },
    );

    expect(teacherAccess.withActiveGrantContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        capability: 'TEACHER_OBSERVATION',
        assignmentId: 31,
        studentUuid: STUDENT_UUID,
      }),
      expect.any(Function),
    );
    expect(repository.createObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        authorKind: 'TEACHER_ACCESS',
        authorUserId: 44,
        authorTeacherMembershipId: 12,
        sourceTeacherAccessGrantId: '11111111-1111-4111-8111-111111111111',
      }),
      RUNNER,
    );
  });

  it('binds task-link observations to the link, selected slot and displayed observer', async () => {
    const { service, repository, taskAccess } = createHarness();
    await service.createWithTaskLink('task-token', 'verified-session', {
      studentTermId: STUDENT_UUID,
      timetableSlotId: 901,
      dimensionCode: 'LEARNING',
      concernLevel: 'WATCH',
      tagCodes: ['MISSING_ASSIGNMENTS'],
    });

    expect(taskAccess.getTaskByToken).toHaveBeenCalledWith('task-token', 'verified-session');
    expect(repository.createObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: 77,
        sourceTaskLinkId: '22222222-2222-4222-8222-222222222222',
        sourceTimetableSlotId: 901,
        sourceAssignmentId: null,
        observerDisplayName: 'ผู้ช่วยเช็คชื่อ',
      }),
      RUNNER,
    );
  });

  it('loads the task-link catalog before a timetable slot is selected', async () => {
    const { service, repository } = createHarness();
    await expect(service.getCatalogWithTaskLink('task-token', 'verified-session')).resolves.toEqual(
      {
        data: { dimensions: [], tags: [] },
      },
    );
    expect(repository.listCatalog).toHaveBeenCalled();
  });

  it('returns bounded pagination and audits raw timeline reads without comment metadata', async () => {
    const { service, repository, auditLog } = createHarness();
    const result = await service.list(STUDENT_UUID, { page: 1, limit: 10 }, MANAGER);

    expect(result.meta).toEqual({ page: 1, limit: 10, totalCount: 1, totalPages: 1 });
    expect(repository.listObservations).toHaveBeenCalledWith(
      STUDENT_UUID,
      expect.objectContaining({ page: 1, limit: 10 }),
      undefined,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STUDENT_OBSERVATION_VIEW',
      }),
    );
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain('comment');
  });

  it('binds token revision reads to the same capability, assignment and student', async () => {
    const { service, repository, teacherAccess } = createHarness();
    await service.listRevisionsWithTeacherAccess(
      'token-value-that-is-at-least-thirty-two-characters',
      STUDENT_UUID,
      '51',
      31,
      { page: 1, limit: 10 },
    );

    expect(teacherAccess.withActiveGrantContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        capability: 'TEACHER_OBSERVATION',
        assignmentId: 31,
        studentUuid: STUDENT_UUID,
      }),
      expect.any(Function),
    );
    expect(repository.listRevisions).toHaveBeenCalledWith('51', 1, 10, RUNNER);
  });
});
