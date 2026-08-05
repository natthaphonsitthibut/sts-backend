import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { CurriculumRepository } from './curriculum.repository';
import { CurriculumService } from './curriculum.service';
import type { CurriculumSubjectRow } from './curriculum.types';

const ACTOR: AuthenticatedRequestUser = {
  id: 7,
  username: 'director',
  roles: ['DIRECTOR'],
  permissions: ['manage-curriculum'],
  data_scope: { school_ids: [10] },
};

const SUBJECT: CurriculumSubjectRow = {
  id: '31',
  school_id: 10,
  school_term_id: '21',
  grade_level_id: 4,
  grade_label: 'ม.1',
  subject_id: 5,
  subject_code: 'ค101',
  subject_name: 'คณิตศาสตร์',
  content_storage_key: 'curriculum-content/old.pdf',
  content_file_name: 'old.pdf',
  content_file_size_bytes: 100,
  curriculum_status: 'ACTIVE',
  updated_at: '2026-08-03T00:00:00.000Z',
};

function createHarness() {
  const repository = {
    withTransaction: jest.fn(
      async (operation: (runner: unknown) => Promise<unknown>) => await operation({}),
    ),
    isSchoolInScope: jest.fn().mockResolvedValue(true),
    listGrades: jest.fn().mockResolvedValue([]),
    findSubjectById: jest.fn().mockResolvedValue(SUBJECT),
    listTeachersForSubjects: jest.fn().mockResolvedValue([]),
    updateContent: jest.fn().mockResolvedValue(undefined),
    upsertSubject: jest.fn().mockResolvedValue({ id: 'subject-1' }),
    createSubjectOffering: jest.fn().mockResolvedValue({ id: 'offering-1' }),
    replaceTeacherCoverage: jest.fn().mockResolvedValue(undefined),
  };
  const auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    save: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn(),
  };
  const service = new CurriculumService(
    repository as unknown as CurriculumRepository,
    auditLog as never,
    storage as never,
  );
  return { service, repository, auditLog, storage };
}

function pdfFile(): Express.Multer.File {
  const buffer = Buffer.from('%PDF-1.4\n% smoke');
  return {
    buffer,
    mimetype: 'application/pdf',
    originalname: 'content.pdf',
    size: buffer.length,
  } as Express.Multer.File;
}

describe('CurriculumService', () => {
  it('rejects duplicate teacher-classroom coverage before opening a transaction', async () => {
    const { service, repository } = createHarness();

    await expect(
      service.createSubject(
        {
          schoolId: 10,
          termId: 21,
          gradeLevelId: 4,
          subjectCode: 'ค101',
          subjectName: 'คณิตศาสตร์',
          teachers: [
            { teacherMembershipIds: [12], classroomIds: [41] },
            { teacherMembershipIds: [12], classroomIds: [41] },
          ],
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  it('expands a block of several teachers into one coverage row per teacher and room', async () => {
    const { service, repository } = createHarness();

    await service.createSubject(
      {
        schoolId: 10,
        termId: 21,
        gradeLevelId: 4,
        subjectCode: 'ค101',
        subjectName: 'คณิตศาสตร์',
        teachers: [{ teacherMembershipIds: [12, 13], classroomIds: [41, 42] }],
      },
      ACTOR,
    );

    const [input] = repository.replaceTeacherCoverage.mock.calls[0] as [
      { coverage: Array<{ teacherMembershipId: number; classroomId: number }> },
    ];
    expect(input.coverage).toEqual([
      { teacherMembershipId: 12, classroomId: 41 },
      { teacherMembershipId: 12, classroomId: 42 },
      { teacherMembershipId: 13, classroomId: 41 },
      { teacherMembershipId: 13, classroomId: 42 },
    ]);
  });

  it('rejects the same teacher and room arriving through two different blocks', async () => {
    const { service, repository } = createHarness();

    await expect(
      service.createSubject(
        {
          schoolId: 10,
          termId: 21,
          gradeLevelId: 4,
          subjectCode: 'ค101',
          subjectName: 'คณิตศาสตร์',
          teachers: [
            { teacherMembershipIds: [12, 13], classroomIds: [41] },
            { teacherMembershipIds: [13], classroomIds: [41] },
          ],
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects grade-limited scope before querying curriculum data', async () => {
    const { service, repository } = createHarness();
    const gradeScopedActor: AuthenticatedRequestUser = {
      ...ACTOR,
      data_scope: { school_ids: [10], grade_levels: [4] },
    };

    await expect(service.listGrades({ schoolId: 10 }, gradeScopedActor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.isSchoolInScope).not.toHaveBeenCalled();
    expect(repository.listGrades).not.toHaveBeenCalled();
  });

  it('rechecks and locks the offering after storing a replacement PDF', async () => {
    const { service, repository, storage } = createHarness();
    repository.findSubjectById
      .mockResolvedValueOnce(SUBJECT)
      .mockResolvedValueOnce(SUBJECT)
      .mockResolvedValueOnce(SUBJECT);

    await service.updateContent('31', ACTOR, pdfFile());

    expect(repository.findSubjectById).toHaveBeenNthCalledWith(2, '31', expect.anything(), true);
    expect(repository.updateContent).toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('curriculum-content/old.pdf');
  });

  it('deletes a newly stored PDF if the offering disappears before the locked write', async () => {
    const { service, repository, storage } = createHarness();
    repository.findSubjectById.mockResolvedValueOnce(SUBJECT).mockResolvedValueOnce(null);

    await expect(service.updateContent('31', ACTOR, pdfFile())).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(repository.updateContent).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(/^curriculum-content\//));
  });
});
