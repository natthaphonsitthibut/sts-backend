import * as xlsx from 'xlsx';
import { ImportsService } from './imports.service';

function makeImportFile(rows: Record<string, unknown>[]): Express.Multer.File {
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

  return {
    buffer,
    originalname: 'students.xlsx',
  } as Express.Multer.File;
}

describe('ImportsService', () => {
  function createService(
    existingStudentTerms: Array<{
      person_id: string;
      academic_year: string;
      semester: string;
      school_id: string;
    }> = [],
  ) {
    const repository = {
      findExistingImportPersonIds: jest.fn().mockResolvedValue([]),
      findExistingStudentTerms: jest.fn().mockResolvedValue(existingStudentTerms),
      findExistingSchoolIds: jest.fn().mockResolvedValue([]),
      findSchoolNames: jest.fn().mockResolvedValue([{ id: 1001, label: 'Test School' }]),
      findGradeLabels: jest.fn().mockResolvedValue([{ id: 101, label: 'ป.1' }]),
    };
    const auditLog = {
      record: jest.fn(),
    };

    return {
      repository,
      service: new ImportsService(repository as never, auditLog as never),
    };
  }

  it('previews exact-template imports with duplicate and existing row counts', async () => {
    const { repository, service } = createService([
      {
        person_id: '2222222222222',
        academic_year: '2567',
        semester: '1',
        school_id: '1001',
      },
    ]);
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        FirstName_Onec: 'A',
        LastName_Onec: 'One',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        GradeLevelID_Onec: 101,
      },
      {
        PersonID_Onec: '1111111111111',
        FirstName_Onec: 'A',
        LastName_Onec: 'Duplicate',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
      },
      {
        PersonID_Onec: '2222222222222',
        FirstName_Onec: 'B',
        LastName_Onec: 'Existing',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
      },
      {
        PersonID_Onec: '',
        FirstName_Onec: 'Blank',
        LastName_Onec: 'Id',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}');

    expect(repository.findExistingStudentTerms).toHaveBeenCalledWith([
      '1111111111111',
      '2222222222222',
    ]);
    expect(preview.canImport).toBe(true);
    expect(preview.mapping.PersonID_Onec).toBe('PersonID_Onec');
    expect(preview.rowsProcessed).toBe(4);
    expect(preview.rowsReady).toBe(2);
    expect(preview.rowsSkipped).toBe(2);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.existingRows).toBe(1);
    expect(preview.missingPersonIdRows).toBe(1);
    expect(preview.rowsToInsert).toBe(1);
    expect(preview.rowsToUpdate).toBe(1);
    expect(preview.sampleRows[0]).toMatchObject({
      personIdMasked: '••••1111',
      status: 'ready',
      schoolName: 'Test School',
      gradeLabel: 'ป.1',
    });
    expect(preview.sampleRows[2]).toMatchObject({ action: 'update', status: 'ready' });
  });

  it('supports custom column mapping before import preview', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        เลขบัตร: '3333333333333',
        ชื่อ: 'Mapped',
        นามสกุล: 'Student',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
    ]);

    const missingRequired = await service.previewImport(file, 'student_term', '{}');
    expect(missingRequired.canImport).toBe(false);
    expect(missingRequired.headers).toEqual([
      'เลขบัตร',
      'ชื่อ',
      'นามสกุล',
      'AcademicYear_Onec',
      'Semester_Onec',
      'SchoolID_Onec',
    ]);
    expect(missingRequired.missingRequiredColumns).toEqual(['PersonID_Onec']);

    const preview = await service.previewImport(
      file,
      'student_term',
      JSON.stringify({
        FirstName_Onec: 'ชื่อ',
        LastName_Onec: 'นามสกุล',
        PersonID_Onec: 'เลขบัตร',
        AcademicYear_Onec: 'AcademicYear_Onec',
        Semester_Onec: 'Semester_Onec',
        SchoolID_Onec: 'SchoolID_Onec',
      }),
    );

    expect(preview.canImport).toBe(true);
    expect(preview.mapping.PersonID_Onec).toBe('เลขบัตร');
    expect(preview.rowsReady).toBe(1);
    expect(preview.sampleRows[0]).toMatchObject({
      firstName: 'Mapped',
      lastName: 'Student',
      personIdMasked: '••••3333',
    });
  });

  it('imports a new term and updates the same natural key on repeat', async () => {
    const writes = new Set<string>();
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      resolveOrCreatePersonByNationalId: jest.fn().mockResolvedValue('person-uuid'),
      insertImportRow: jest.fn(
        (_target: string, row: Record<string, unknown>): 'inserted' | 'updated' => {
          const key = JSON.stringify([
            row.person_uuid,
            row.AcademicYear_Onec,
            row.Semester_Onec,
            row.SchoolID_Onec,
          ]);
          if (writes.has(key)) {
            return 'updated';
          }
          writes.add(key);
          return 'inserted';
        },
      ),
      upsertManualSchool: jest.fn(),
    };
    const auditLog = { record: jest.fn() };
    const service = new ImportsService(repository as never, auditLog as never);
    const file = makeImportFile([
      {
        PersonID_Onec: '4444444444444',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        FirstName_Onec: 'First',
      },
      {
        PersonID_Onec: '4444444444444',
        AcademicYear_Onec: 2567,
        Semester_Onec: 2,
        SchoolID_Onec: 1001,
        FirstName_Onec: 'Second',
      },
    ]);

    const first = await service.processImport(file, 'student_term', '{}');
    const repeated = await service.processImport(file, 'student_term', '{}');

    expect(first).toMatchObject({ rowsInserted: 2, rowsUpdated: 0, rowsSkipped: 0 });
    expect(repeated).toMatchObject({ rowsInserted: 0, rowsUpdated: 2, rowsSkipped: 0 });
    expect(repository.resolveOrCreatePersonByNationalId).toHaveBeenCalledTimes(4);
  });
});
