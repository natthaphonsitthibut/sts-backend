import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SchoolStructureRepository } from '../school-structure/school-structure.repository';
import { SubjectsRepository } from './subjects.repository';
import { SubjectsService } from './subjects.service';
import type { ClassroomSubjectRow, SchoolSubjectRow } from './subjects.types';

describe('SubjectsService', () => {
  let service: SubjectsService;
  let repository: jest.Mocked<SubjectsRepository>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;
  let schoolStructureRepository: jest.Mocked<Pick<SchoolStructureRepository, 'isSchoolInScope'>>;

  const actor = {
    id: 3,
    username: 'admin1',
    roles: ['ADMIN'],
    permissions: ['manage-subjects'],
    data_scope: { global: true },
  };

  function schoolSubjectRow(overrides: Partial<SchoolSubjectRow> = {}): SchoolSubjectRow {
    return {
      id: '10',
      school_id: 1001,
      subject_id: 1,
      code: 'MATH101',
      name_th: 'คณิตศาสตร์',
      subject_status: 'ACTIVE',
      classroom_count: 2,
      created_at: new Date('2026-08-23T00:00:00Z'),
      updated_at: new Date('2026-08-23T00:00:00Z'),
      ...overrides,
    };
  }

  function classroomSubjectRow(overrides: Partial<ClassroomSubjectRow> = {}): ClassroomSubjectRow {
    return {
      id: '20',
      school_id: 1001,
      classroom_id: '42',
      school_subject_id: '10',
      subject_id: 1,
      code: 'MATH101',
      name_th: 'คณิตศาสตร์',
      offering_status: 'ACTIVE',
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      withTransaction: jest.fn((operation: (queryRunner: unknown) => unknown) => operation({})),
      listSchoolCatalog: jest.fn().mockResolvedValue({ rows: [schoolSubjectRow()], totalCount: 1 }),
      createSchoolSubject: jest.fn().mockResolvedValue(schoolSubjectRow()),
      findSchoolSubjectById: jest.fn().mockResolvedValue(schoolSubjectRow()),
      updateSchoolSubjectStatus: jest
        .fn()
        .mockResolvedValue(schoolSubjectRow({ subject_status: 'INACTIVE' })),
      findClassroomScope: jest
        .fn()
        .mockResolvedValue({ id: '42', school_id: 1001, grade_level_id: 4 }),
      listClassroomOfferings: jest.fn().mockResolvedValue([classroomSubjectRow()]),
      countActiveSchoolSubjects: jest.fn().mockResolvedValue(1),
      replaceClassroomOfferings: jest.fn().mockResolvedValue(undefined),
      listSubjectGrades: jest.fn().mockResolvedValue([
        {
          grade_level_id: 4,
          grade_label: 'อ.1',
          grade_category: 'KINDERGARTEN',
          subject_count: 2,
        },
      ]),
      listGradeSchoolSubjects: jest.fn().mockResolvedValue({
        rows: [
          {
            ...schoolSubjectRow(),
            grade_level_id: 4,
            grade_label: 'อ.1',
          },
        ],
        totalCount: 1,
      }),
      listGradeSubjectClassrooms: jest.fn().mockResolvedValue([
        {
          school_subject_id: '10',
          classroom_id: '42',
          classroom_label: 'อ.1/1',
        },
      ]),
      assertGradeClassrooms: jest.fn().mockResolvedValue(true),
      updateSubjectName: jest.fn().mockResolvedValue(undefined),
      isSubjectSharedWithAnotherSchool: jest.fn().mockResolvedValue(false),
      replaceGradeSubjectClassrooms: jest.fn().mockResolvedValue(undefined),
      removeGradeSubjectClassrooms: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SubjectsRepository>;
    auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    schoolStructureRepository = { isSchoolInScope: jest.fn().mockResolvedValue(true) };
    service = new SubjectsService(
      repository,
      auditLog as unknown as AuditLogService,
      schoolStructureRepository as unknown as SchoolStructureRepository,
    );
  });

  it('lists the school catalog only after server-side school scope succeeds', async () => {
    const result = await service.listSchoolCatalog(actor, { schoolId: 1001, page: 1, limit: 20 });

    expect(schoolStructureRepository.isSchoolInScope.mock.calls).toContainEqual([
      1001,
      { global: true },
    ]);
    expect(result.data[0]).toMatchObject({ id: 10, code: 'MATH101', classroomCount: 2 });
  });

  it('treats every school subject uniformly when changing status', async () => {
    await expect(
      service.updateSchoolSubject(actor, 10, { status: 'INACTIVE' }),
    ).resolves.toMatchObject({ data: { status: 'INACTIVE' } });
  });

  it('replaces classroom offerings atomically after validating every school subject', async () => {
    const result = await service.replaceClassroomOfferings(actor, 42, {
      schoolSubjectIds: [10],
    });

    expect(repository.replaceClassroomOfferings.mock.calls).toContainEqual([
      expect.objectContaining({ classroomId: 42, schoolId: 1001, schoolSubjectIds: [10] }),
      expect.anything(),
    ]);
    expect(auditLog.recordAtomic.mock.calls).toContainEqual([
      expect.objectContaining({ action: 'CLASSROOM_SUBJECTS_REPLACE' }),
      expect.anything(),
    ]);
    expect(result.data).toHaveLength(1);
  });

  it('rejects classroom offerings from another school', async () => {
    repository.countActiveSchoolSubjects.mockResolvedValue(0);

    await expect(
      service.replaceClassroomOfferings(actor, 42, { schoolSubjectIds: [999] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceClassroomOfferings.mock.calls).toHaveLength(0);
  });

  it('lists grade subjects with classroom labels from the replacement relation', async () => {
    const result = await service.listGradeSchoolSubjects(actor, {
      schoolId: 1001,
      termId: 30,
      gradeLevelId: 4,
      page: 1,
      limit: 20,
    });

    expect(result.data[0]).toMatchObject({
      id: 10,
      subjectName: 'คณิตศาสตร์',
      classrooms: [{ id: 42, label: 'อ.1/1' }],
    });
    expect(repository.listGradeSubjectClassrooms.mock.calls).toContainEqual([
      {
        schoolSubjectIds: [10],
        schoolId: 1001,
        termId: 30,
        gradeLevelId: 4,
      },
    ]);
  });

  it('creates a grade subject and classroom offerings in one transaction', async () => {
    const result = await service.saveGradeSchoolSubject(actor, null, {
      schoolId: 1001,
      termId: 30,
      gradeLevelId: 4,
      code: 'ค11101',
      nameTh: 'คณิตศาสตร์',
      classroomIds: [42],
    });

    expect(repository.assertGradeClassrooms.mock.calls).toContainEqual([
      expect.objectContaining({ classroomIds: [42], schoolId: 1001, termId: 30 }),
      expect.anything(),
    ]);
    expect(repository.replaceGradeSubjectClassrooms.mock.calls).toContainEqual([
      expect.objectContaining({ schoolSubjectId: 10, classroomIds: [42] }),
      expect.anything(),
    ]);
    expect(result.data.classrooms).toEqual([{ id: 42, label: 'อ.1/1' }]);
  });

  it('rejects a room outside the selected school, term, or grade', async () => {
    repository.assertGradeClassrooms.mockResolvedValue(false);

    await expect(
      service.saveGradeSchoolSubject(actor, null, {
        schoolId: 1001,
        termId: 30,
        gradeLevelId: 4,
        code: 'ค11101',
        nameTh: 'คณิตศาสตร์',
        classroomIds: [999],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createSchoolSubject.mock.calls).toHaveLength(0);
    expect(repository.replaceGradeSubjectClassrooms.mock.calls).toHaveLength(0);
  });

  it('rejects renaming a global subject shared with another school', async () => {
    repository.isSubjectSharedWithAnotherSchool.mockResolvedValue(true);

    await expect(
      service.saveGradeSchoolSubject(actor, 10, {
        schoolId: 1001,
        termId: 30,
        gradeLevelId: 4,
        code: 'MATH101',
        nameTh: 'ชื่อใหม่',
        classroomIds: [42],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateSubjectName.mock.calls).toHaveLength(0);
    expect(repository.replaceGradeSubjectClassrooms.mock.calls).toHaveLength(0);
  });
});
