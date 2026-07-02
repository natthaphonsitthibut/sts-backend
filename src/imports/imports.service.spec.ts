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
  function createService(existingPersonIds: string[] = []) {
    const repository = {
      findExistingImportPersonIds: jest.fn().mockResolvedValue(existingPersonIds),
      findExistingSchoolIds: jest.fn().mockResolvedValue([]),
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
    const { repository, service } = createService(['2222222222222']);
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        FirstName_Onec: 'A',
        LastName_Onec: 'One',
        SchoolID_Onec: 1001,
      },
      {
        PersonID_Onec: '1111111111111',
        FirstName_Onec: 'A',
        LastName_Onec: 'Duplicate',
        SchoolID_Onec: 1001,
      },
      {
        PersonID_Onec: '2222222222222',
        FirstName_Onec: 'B',
        LastName_Onec: 'Existing',
        SchoolID_Onec: 1001,
      },
      {
        PersonID_Onec: '',
        FirstName_Onec: 'Blank',
        LastName_Onec: 'Id',
        SchoolID_Onec: 1001,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}');

    expect(repository.findExistingImportPersonIds).toHaveBeenCalledWith('student_term', [
      '1111111111111',
      '2222222222222',
    ]);
    expect(preview.canImport).toBe(true);
    expect(preview.mapping.PersonID_Onec).toBe('PersonID_Onec');
    expect(preview.rowsProcessed).toBe(4);
    expect(preview.rowsReady).toBe(1);
    expect(preview.rowsSkipped).toBe(3);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.existingRows).toBe(1);
    expect(preview.missingPersonIdRows).toBe(1);
    expect(preview.sampleRows[0]).toMatchObject({
      personIdMasked: '••••1111',
      status: 'ready',
    });
  });

  it('supports custom column mapping before import preview', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        เลขบัตร: '3333333333333',
        ชื่อ: 'Mapped',
        นามสกุล: 'Student',
      },
    ]);

    const missingRequired = await service.previewImport(file, 'student_term', '{}');
    expect(missingRequired.canImport).toBe(false);
    expect(missingRequired.headers).toEqual(['เลขบัตร', 'ชื่อ', 'นามสกุล']);
    expect(missingRequired.missingRequiredColumns).toEqual(['PersonID_Onec']);

    const preview = await service.previewImport(
      file,
      'student_term',
      JSON.stringify({
        FirstName_Onec: 'ชื่อ',
        LastName_Onec: 'นามสกุล',
        PersonID_Onec: 'เลขบัตร',
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
});
