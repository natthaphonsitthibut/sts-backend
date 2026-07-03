import * as xlsx from 'xlsx';
import { createHash } from 'crypto';
import { ImportsService } from './imports.service';

const GLOBAL_ACTOR = { id: 1, data_scope: { global: true } } as never;

function candidateKey(quarantineRowId: string, personUuid: string): string {
  return createHash('sha256').update(`${quarantineRowId}:${personUuid}`).digest('hex');
}

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

function makeCsvImportFile(csv: string): Express.Multer.File {
  return {
    buffer: Buffer.from(csv, 'utf8'),
    originalname: 'students.csv',
  } as Express.Multer.File;
}

describe('ImportsService', () => {
  function createService(
    existingStudentTerms: Array<{
      person_id: string;
      academic_year: string;
      semester: string;
      school_id: string;
      mutable_values?: Record<string, unknown>;
    }> = [],
  ) {
    const repository = {
      findExistingImportPersonIds: jest.fn().mockResolvedValue([]),
      findExistingStudentTerms: jest.fn().mockResolvedValue(existingStudentTerms),
      findConflictingNationalIds: jest.fn().mockResolvedValue([]),
      findExistingSchoolIds: jest.fn().mockResolvedValue([]),
      findSchoolScopeDetails: jest.fn().mockResolvedValue([]),
      findSchoolNames: jest.fn().mockResolvedValue([{ id: 1001, label: 'Test School' }]),
      findGradeLabels: jest.fn().mockResolvedValue([{ id: 101, label: 'ป.1' }]),
      findStudentStatusLabels: jest
        .fn()
        .mockResolvedValue([{ id: 10, label: 'กำลังศึกษา', category: 'ACTIVE' }]),
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
        person_id: '1111111111111',
        academic_year: '2567',
        semester: '1',
        school_id: '2002',
      },
      {
        person_id: '2222222222222',
        academic_year: '2567',
        semester: '1',
        school_id: '1001',
        mutable_values: { FirstName_Onec: 'Old name' },
      },
    ]);
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        PassportNumber_Onec: 'TEST-PASSPORT-ABCD',
        FirstName_Onec: 'A',
        LastName_Onec: 'One',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        GradeLevelID_Onec: 101,
        StudentStatusID_Onec: 10,
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

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(repository.findExistingStudentTerms).toHaveBeenCalledWith(
      ['1111111111111', '2222222222222'],
      { global: true },
    );
    expect(preview.canImport).toBe(true);
    expect(preview.mapping.PersonID_Onec).toBe('PersonID_Onec');
    expect(preview.rowsProcessed).toBe(4);
    expect(preview.rowsReady).toBe(2);
    expect(preview.rowsSkipped).toBe(0);
    expect(preview.rowsToQuarantine).toBe(2);
    expect(preview.duplicateRows).toBe(1);
    expect(preview.existingRows).toBe(1);
    expect(preview.missingPersonIdRows).toBe(1);
    expect(preview.rowsToInsert).toBe(1);
    expect(preview.rowsToUpdate).toBe(1);
    expect(preview.differentSchoolRows).toBe(1);
    expect(preview.sampleRows[0]).toMatchObject({
      personIdMasked: '••••1111',
      status: 'ready',
      schoolName: 'Test School',
      gradeLabel: 'ป.1',
      studentStatusLabel: 'กำลังศึกษา',
      hasDifferentSchoolSnapshot: true,
    });
    expect(preview.sampleRows[2]).toMatchObject({
      action: 'update',
      status: 'ready',
      changedFields: ['ชื่อ', 'นามสกุล'],
    });
    expect(preview.mappedColumnSamples.PassportNumber_Onec).toEqual(['••••ABCD']);
    expect(JSON.stringify(preview.mappedColumnSamples)).not.toContain('TEST-PASSPORT-ABCD');
  });

  it('quarantines unknown grades and invalid room formats in preview', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        GradeLevelID_Onec: 999,
        RoomID_Onec: 1,
      },
      {
        PersonID_Onec: '2222222222222',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        GradeLevelID_Onec: 101,
        RoomID_Onec: 'ห้องหนึ่ง',
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      rowsToQuarantine: 2,
      gradeIssueRows: 1,
      roomIssueRows: 1,
    });
    expect(preview.sampleRows[0].issues).toContain('ชั้นเรียนไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
    expect(preview.sampleRows[1].issues).toContain('รหัสห้องต้องเป็นจำนวนเต็มบวก');
  });

  it('enforces actor data scope before returning student-term preview matches', async () => {
    const { repository, service } = createService();
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
      },
    ]);

    await expect(
      service.previewImport(file, 'student_term', '{}', {
        id: 1,
        data_scope: {},
      } as never),
    ).rejects.toThrow('บัญชีนี้ไม่มีขอบเขตสำหรับนำเข้าข้อมูลนักเรียน');
    await expect(
      service.previewImport(file, 'student_term', '{}', {
        id: 1,
        data_scope: { school_ids: [2002] },
      } as never),
    ).rejects.toThrow('ไม่มีสิทธิ์นำเข้าข้อมูลโรงเรียน 1001');
    expect(repository.findExistingStudentTerms).not.toHaveBeenCalled();
    expect(repository.findConflictingNationalIds).not.toHaveBeenCalled();
  });

  it('supports Thai custom column mapping before import preview', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        เลขบัตร: '3333333333333',
        ชื่อ: 'Mapped',
        นามสกุล: 'Student',
        ปีการศึกษา: 2567,
        ภาคเรียน: 1,
        รหัสโรงเรียน: 1001,
      },
    ]);

    const missingRequired = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);
    expect(missingRequired.canImport).toBe(false);
    expect(missingRequired.headers).toEqual([
      'เลขบัตร',
      'ชื่อ',
      'นามสกุล',
      'ปีการศึกษา',
      'ภาคเรียน',
      'รหัสโรงเรียน',
    ]);
    expect(missingRequired.missingRequiredColumns).toEqual([
      'PersonID_Onec',
      'AcademicYear_Onec',
      'Semester_Onec',
      'SchoolID_Onec',
    ]);

    const preview = await service.previewImport(
      file,
      'student_term',
      JSON.stringify({
        FirstName_Onec: 'ชื่อ',
        LastName_Onec: 'นามสกุล',
        PersonID_Onec: 'เลขบัตร',
        AcademicYear_Onec: 'ปีการศึกษา',
        Semester_Onec: 'ภาคเรียน',
        SchoolID_Onec: 'รหัสโรงเรียน',
      }),
      GLOBAL_ACTOR,
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

  it('previews reordered CSV columns and trims identifier whitespace', async () => {
    const { repository, service } = createService();
    const file = makeCsvImportFile(
      [
        'SchoolID_Onec,LastName_Onec,PersonID_Onec,Semester_Onec,AcademicYear_Onec,FirstName_Onec',
        ' 1001 ,Student, 5555555555555 , 1 , 2567 , CSV ',
      ].join('\n'),
    );

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(repository.findExistingStudentTerms).toHaveBeenCalledWith(['5555555555555'], {
      global: true,
    });
    expect(preview).toMatchObject({
      canImport: true,
      rowsProcessed: 1,
      rowsReady: 1,
      rowsSkipped: 0,
      rowsToInsert: 1,
    });
    expect(preview.headers).toEqual([
      'SchoolID_Onec',
      'LastName_Onec',
      'PersonID_Onec',
      'Semester_Onec',
      'AcademicYear_Onec',
      'FirstName_Onec',
    ]);
    expect(preview.sampleRows[0]).toMatchObject({
      personIdMasked: '••••5555',
      firstName: 'CSV',
      lastName: 'Student',
      schoolId: '1001',
      academicYear: '2567',
      semester: '1',
    });
  });

  it('rejects CSV files above the 10,000-row import limit', async () => {
    const { service } = createService();
    const rows = Array.from(
      { length: 10_001 },
      (_, index) => `${String(index + 1).padStart(13, '0')},2567,1,1001`,
    );
    const file = makeCsvImportFile(
      ['PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec', ...rows].join('\n'),
    );

    await expect(service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR)).rejects.toThrow(
      'ไฟล์มีจำนวนแถวเกินกำหนด (สูงสุด 10000 แถว)',
    );
  });

  it('quarantines rows with non-integer student-term natural keys', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        PersonID_Onec: '6666666666661',
        AcademicYear_Onec: '2.567e3',
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
      {
        PersonID_Onec: '6666666666662',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1.5,
        SchoolID_Onec: 1001,
      },
      {
        PersonID_Onec: '6666666666663',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: -1,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      canImport: true,
      rowsProcessed: 3,
      rowsReady: 0,
      rowsSkipped: 0,
      rowsToQuarantine: 3,
      missingNaturalKeyRows: 3,
    });
    expect(preview.sampleRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'quarantine',
          action: 'quarantine',
          issues: ['ปีการศึกษา เทอม หรือโรงเรียนไม่ครบหรือรูปแบบไม่ถูกต้อง'],
        }),
      ]),
    );
  });

  it('marks unknown student status as unmapped without blocking preview', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        PersonID_Onec: '7777777777777',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        StudentStatusID_Onec: 999,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      canImport: true,
      rowsReady: 0,
      rowsSkipped: 0,
      rowsToQuarantine: 1,
    });
    expect(preview.sampleRows[0]).toMatchObject({
      status: 'quarantine',
      action: 'quarantine',
      studentStatusCode: '999',
      studentStatusLabel: 'ยังไม่ได้จับคู่',
      studentStatusCategory: 'UNMAPPED',
      issues: ['สถานะนักเรียนยังไม่ได้จับคู่'],
    });
  });

  it('previews duplicate identity matches as quarantine', async () => {
    const { repository, service } = createService();
    repository.findConflictingNationalIds.mockResolvedValue(['7777777777778']);
    const file = makeImportFile([
      {
        PersonID_Onec: '7777777777778',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({ rowsReady: 0, rowsToQuarantine: 1 });
    expect(preview.sampleRows[0]).toMatchObject({
      status: 'quarantine',
      action: 'quarantine',
      issues: ['พบรหัสประจำตัวผูกกับบุคคลมากกว่าหนึ่งคน'],
    });
  });

  it('reports missing schools without hiding otherwise valid preview rows', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        PersonID_Onec: '8888888888888',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 2002,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      canImport: true,
      rowsReady: 1,
      rowsSkipped: 0,
      missingSchoolRows: 1,
      missingSchools: [{ id: 2002 }],
    });
    expect(preview.sampleRows[0]).toMatchObject({
      status: 'ready',
      action: 'insert',
      issues: ['ไม่พบโรงเรียนในข้อมูลหลัก'],
    });
  });

  it('enforces actor school scope when checking missing schools', async () => {
    const { repository, service } = createService();
    repository.findSchoolScopeDetails.mockResolvedValue([
      { id: 1001, province: null, district: null, sub_district: null },
    ]);
    repository.findExistingSchoolIds.mockResolvedValue([1001]);
    const file = makeImportFile([{ SchoolID_Onec: 1001 }]);

    await expect(
      service.checkMissingSchools(file, '{}', {
        id: 1,
        data_scope: { school_ids: [2002] },
      } as never),
    ).rejects.toThrow('ไม่มีสิทธิ์นำเข้าข้อมูลโรงเรียน 1001');

    await expect(
      service.checkMissingSchools(file, '{}', {
        id: 1,
        data_scope: { school_ids: [1001] },
      } as never),
    ).resolves.toEqual({ missingSchools: [] });
  });

  it('does not apply student-term school resolution to dropout preview', async () => {
    const { service } = createService();
    const file = makeImportFile([{ PersonID_Onec: 'DROPOUT-001', SchoolID_Onec: 2002 }]);

    const preview = await service.previewImport(file, 'student_dropouts', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      canImport: true,
      rowsReady: 1,
      missingSchoolRows: 0,
      missingSchools: [],
    });
  });

  it('requires missing-school resolution before bulk import', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([]),
      findSchoolScopeDetails: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      upsertManualSchool: jest.fn(),
      resolveOrCreatePersonByNationalId: jest.fn().mockResolvedValue('person-uuid'),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue([]),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      { record: jest.fn(), recordAtomic: jest.fn() } as never,
    );
    const file = makeImportFile([
      {
        PersonID_Onec: '9999999999999',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 2002,
      },
    ]);

    const actor = { id: 1, data_scope: { global: true } } as never;
    await expect(
      service.processImport(file, 'student_term', '{}', undefined, actor),
    ).rejects.toThrow('ไม่พบโรงเรียนในข้อมูลหลัก: 2002');
    expect(repository.withTransaction).not.toHaveBeenCalled();

    const result = await service.processImport(
      file,
      'student_term',
      '{}',
      JSON.stringify([{ id: 2002, name: 'Resolved test school' }]),
      actor,
    );
    expect(result).toMatchObject({ rowsInserted: 1, rowsUpdated: 0, rowsSkipped: 0 });
    expect(repository.upsertManualSchool).toHaveBeenCalledWith(
      { id: 2002, name: 'Resolved test school' },
      expect.anything(),
    );
  });

  it('enforces actor school scope on bulk import', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest.fn().mockResolvedValue([
        {
          id: 1001,
          province: 'เชียงใหม่',
          district: 'เมืองเชียงใหม่',
          sub_district: 'ช้างเผือก',
        },
      ]),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue([]),
      resolveOrCreatePersonByNationalId: jest.fn().mockResolvedValue('person-uuid'),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      completeImportBatch: jest.fn(),
      upsertManualSchool: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      { record: jest.fn(), recordAtomic: jest.fn() } as never,
    );
    const file = makeImportFile([
      {
        PersonID_Onec: '1010101010101',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
    ]);

    await expect(
      service.processImport(file, 'student_term', '{}', undefined, {
        id: 1,
        data_scope: {},
      } as never),
    ).rejects.toThrow('บัญชีนี้ไม่มีขอบเขตสำหรับนำเข้าข้อมูลนักเรียน');
    await expect(
      service.processImport(file, 'student_term', '{}', undefined, {
        id: 1,
        data_scope: { school_ids: [2002] },
      } as never),
    ).rejects.toThrow('ไม่มีสิทธิ์นำเข้าข้อมูลโรงเรียน 1001');

    await expect(
      service.processImport(file, 'student_term', '{}', undefined, {
        id: 1,
        data_scope: { school_ids: [1001] },
      } as never),
    ).resolves.toMatchObject({ rowsInserted: 1 });
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
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue([]),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn(),
    };
    const auditLog = { record: jest.fn(), recordAtomic: jest.fn() };
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

    const actor = { id: 1, data_scope: { global: true } } as never;
    const first = await service.processImport(file, 'student_term', '{}', undefined, actor);
    const repeated = await service.processImport(file, 'student_term', '{}', undefined, actor);

    expect(first).toMatchObject({ rowsInserted: 2, rowsUpdated: 0, rowsSkipped: 0 });
    expect(repeated).toMatchObject({ rowsInserted: 0, rowsUpdated: 2, rowsSkipped: 0 });
    expect(repository.resolveOrCreatePersonByNationalId).toHaveBeenCalledTimes(2);
    expect(repository.findPersonUuidMatchesByNationalIds).toHaveBeenCalledTimes(2);
    expect(auditLog.recordAtomic).toHaveBeenCalledTimes(2);
  });

  it('writes canonical student status code for mapped import rows', async () => {
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      resolveOrCreatePersonByNationalId: jest.fn().mockResolvedValue('person-uuid'),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      upsertManualSchool: jest.fn(),
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findStudentStatusLabels: jest
        .fn()
        .mockResolvedValue([{ id: 10, label: 'กำลังศึกษา', category: 'ACTIVE' }]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue([]),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      { record: jest.fn(), recordAtomic: jest.fn() } as never,
    );
    const file = makeImportFile([
      {
        PersonID_Onec: '4545454545454',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        StudentStatusID_Onec: 10,
      },
    ]);

    await service.processImport(file, 'student_term', '{}', undefined, {
      id: 1,
      data_scope: { global: true },
    } as never);

    expect(repository.insertImportRow).toHaveBeenCalledWith(
      'student_term',
      expect.objectContaining({
        StudentStatusID_Onec: 10,
        student_status_code: 10,
      }),
      expect.anything(),
    );
  });

  it('persists a FAILED batch marker when transactional import writes fail', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      resolveOrCreatePersonByNationalId: jest.fn().mockResolvedValue('person-uuid'),
      insertImportRow: jest.fn().mockRejectedValue(new Error('database write failed')),
      completeImportBatch: jest.fn(),
      failImportBatch: jest.fn(),
      upsertManualSchool: jest.fn(),
    };
    const auditLog = { record: jest.fn(), recordAtomic: jest.fn() };
    const service = new ImportsService(repository as never, auditLog as never);
    const file = makeImportFile([
      {
        PersonID_Onec: '4444444444444',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
    ]);

    await expect(
      service.processImport(file, 'student_term', '{}', undefined, {
        id: 1,
        data_scope: { global: true },
      } as never),
    ).rejects.toThrow('database write failed');

    expect(repository.failImportBatch).toHaveBeenCalledWith('batch-id');
    expect(repository.completeImportBatch).not.toHaveBeenCalled();
    expect(auditLog.recordAtomic).not.toHaveBeenCalled();
  });

  it('quarantines identity conflicts without writing enrollment', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([
        { identifier_normalized: '1212121212121', person_uuid: 'person-a' },
        { identifier_normalized: '1212121212121', person_uuid: 'person-b' },
      ]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue(['person-a', 'person-b']),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn(),
      resolveOrCreatePersonByNationalId: jest.fn(),
      insertImportRow: jest.fn(),
      upsertManualSchool: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      { record: jest.fn(), recordAtomic: jest.fn() } as never,
    );
    const file = makeImportFile([
      {
        PersonID_Onec: '1212121212121',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
      },
    ]);

    const result = await service.processImport(file, 'student_term', '{}', undefined, {
      id: 1,
      data_scope: { global: true },
    } as never);

    expect(result).toMatchObject({ rowsInserted: 0, rowsQuarantined: 1 });
    expect(result).not.toHaveProperty('batchId');
    expect(repository.quarantineImportRow).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'IDENTIFIER_CONFLICT' }),
      expect.anything(),
    );
    expect(repository.insertImportRow).not.toHaveBeenCalled();
  });

  it('quarantines invalid grade and room values before enrollment writes', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findStudentStatusLabels: jest.fn().mockResolvedValue([]),
      findGradeLabels: jest.fn().mockResolvedValue([{ id: 101, label: 'ป.1' }]),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      createImportBatch: jest.fn().mockResolvedValue('batch-id'),
      findPersonUuidMatchesByNationalIds: jest.fn().mockResolvedValue([]),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue([]),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn(),
      resolveOrCreatePersonByNationalId: jest.fn(),
      insertImportRow: jest.fn(),
      upsertManualSchool: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      { record: jest.fn(), recordAtomic: jest.fn() } as never,
    );
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        GradeLevelID_Onec: 999,
        RoomID_Onec: 1,
      },
      {
        PersonID_Onec: '2222222222222',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        GradeLevelID_Onec: 101,
        RoomID_Onec: 'ห้องหนึ่ง',
      },
    ]);

    const result = await service.processImport(file, 'student_term', '{}', undefined, {
      id: 1,
      data_scope: { global: true },
    } as never);

    expect(result).toMatchObject({ rowsInserted: 0, rowsQuarantined: 2 });
    expect(repository.quarantineImportRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reasonCode: 'GRADE_NOT_FOUND' }),
      expect.anything(),
    );
    expect(repository.quarantineImportRow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reasonCode: 'ROOM_NOT_FOUND' }),
      expect.anything(),
    );
    expect(repository.insertImportRow).not.toHaveBeenCalled();
  });

  it('lists scoped quarantine rows with identifiers masked', async () => {
    const repository = {
      listQuarantine: jest.fn().mockResolvedValue({
        rows: [
          {
            id: '1',
            batch_id: 'batch-id',
            school_id: 1001,
            school_name: 'Test School',
            source_row_number: 2,
            reason_code: 'IDENTIFIER_CONFLICT',
            status: 'PENDING',
            target: 'student_term',
            mapped_values: {
              PersonID_Onec: '1234567890123',
              FirstName_Onec: 'Test',
              LastName_Onec: 'Student',
            },
          },
        ],
        totalCount: 1,
      }),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);
    const actor = { id: 1, data_scope: { school_ids: [1001] } } as never;

    const result = await service.listQuarantine({ page: 1, limit: 20 }, actor);

    expect(repository.listQuarantine).toHaveBeenCalledWith(
      {
        page: 1,
        limit: 20,
        status: undefined,
        reasonCode: undefined,
        search: undefined,
        province: undefined,
        district: undefined,
        subDistrict: undefined,
        schoolId: undefined,
      },
      { school_ids: [1001] },
    );
    expect(result.items[0].student.personIdMasked).toBe('••••0123');
    expect(JSON.stringify(result)).not.toContain('1234567890123');
  });

  it('fails closed when resolving a quarantine row outside actor scope', async () => {
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findQuarantineForUpdate: jest.fn().mockResolvedValue(null),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    await expect(
      service.resolveQuarantine('1', { action: 'REJECT' }, {
        id: 1,
        data_scope: { school_ids: [1001] },
      } as never),
    ).rejects.toThrow('ไม่พบรายการนำเข้าที่รอตรวจสอบ');
  });

  it('resolves an identity conflict only to a matching candidate', async () => {
    const auditLog = { record: jest.fn(), recordAtomic: jest.fn() };
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findQuarantineForUpdate: jest.fn().mockResolvedValue({
        id: '1',
        status: 'PENDING',
        reason_code: 'IDENTIFIER_CONFLICT',
        target: 'student_term',
        mapped_values: {
          PersonID_Onec: '1234567890123',
          AcademicYear_Onec: 2567,
          Semester_Onec: 1,
          SchoolID_Onec: 1001,
          StudentStatusID_Onec: 10,
        },
      }),
      findPersonUuidsByNationalId: jest.fn().mockResolvedValue(['person-a', 'person-b']),
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findStudentStatusLabels: jest
        .fn()
        .mockResolvedValue([{ id: 10, label: 'กำลังศึกษา', category: 'ACTIVE' }]),
      findGradeLabels: jest.fn().mockResolvedValue([]),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      resolveQuarantineRow: jest.fn(),
    };
    const service = new ImportsService(repository as never, auditLog as never);
    const actor = { id: 1, data_scope: { global: true } } as never;

    await expect(
      service.resolveQuarantine(
        '1',
        { action: 'RESOLVE', candidateKey: candidateKey('1', 'other') },
        actor,
      ),
    ).rejects.toThrow('บุคคลที่เลือกไม่ตรงกับรหัสประจำตัวในรายการ');

    const result = await service.resolveQuarantine(
      '1',
      { action: 'RESOLVE', candidateKey: candidateKey('1', 'person-a') },
      actor,
    );
    expect(result).toEqual({ id: '1', status: 'RESOLVED' });
    expect(repository.insertImportRow).toHaveBeenCalledWith(
      'student_term',
      expect.objectContaining({ person_uuid: 'person-a', student_status_code: 10 }),
      expect.anything(),
    );
    expect(repository.findPersonUuidsByNationalId).toHaveBeenLastCalledWith(
      '1234567890123',
      { global: true },
      expect.anything(),
      50,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_QUARANTINE_RESOLVED', targetId: '1' }),
      expect.anything(),
    );
  });

  it('returns masked identity candidates for an in-scope quarantine row', async () => {
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findQuarantine: jest.fn().mockResolvedValue({
        status: 'PENDING',
        reason_code: 'IDENTIFIER_CONFLICT',
        mapped_values: { PersonID_Onec: '1234567890123' },
      }),
      findPersonCandidateDetailsByNationalId: jest.fn().mockResolvedValue([
        { person_uuid: 'person-a', first_name: 'A', last_name: 'One' },
        { person_uuid: 'person-b', first_name: 'B', last_name: 'Two' },
      ]),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    const result = await service.listQuarantineCandidates('1', {
      id: 1,
      data_scope: { school_ids: [1001] },
    } as never);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      candidateKey: candidateKey('1', 'person-a'),
      personIdMasked: '••••0123',
    });
    expect(repository.findPersonCandidateDetailsByNationalId).toHaveBeenCalledWith(
      '1234567890123',
      { school_ids: [1001] },
      expect.anything(),
    );
    expect(JSON.stringify(result)).not.toContain('person-a');
    expect(JSON.stringify(result)).not.toContain('1234567890123');
  });

  it('exports a scoped readable CSV with masked identifiers', async () => {
    const auditLog = { record: jest.fn() };
    const repository = {
      listQuarantine: jest.fn().mockResolvedValue({
        rows: [
          {
            source_row_number: 2,
            batch_id: 'batch-uuid',
            batch_created_at: new Date('2026-07-03T04:00:00.000Z'),
            reason_code: 'IDENTIFIER_CONFLICT',
            status: 'REJECTED',
            school_id: 1001,
            school_name: '=FORMULA',
            mapped_values: {
              PersonID_Onec: '1234567890123',
              FirstName_Onec: 'สมชาย',
              LastName_Onec: 'ใจดี',
              AcademicYear_Onec: 2569,
              Semester_Onec: 1,
            },
          },
        ],
        totalCount: 1,
      }),
    };
    const service = new ImportsService(repository as never, auditLog as never);

    const csv = await service.exportQuarantine(
      { status: 'REJECTED' } as never,
      {
        id: 1,
        data_scope: { school_ids: [1001] },
      } as never,
    );

    expect(csv).toContain('••••0123');
    expect(csv).toContain("'=FORMULA");
    expect(csv).toContain('สมชาย');
    expect(csv).toContain('เลขนี้ตรงกับหลายโปรไฟล์ในระบบ');
    expect(csv).toContain('ปฏิเสธแล้ว');
    expect(csv).toContain('2026-07-03T04:00:00.000Z');
    expect(csv).not.toContain('1234567890123');
    expect(csv).not.toContain('IDENTIFIER_CONFLICT');
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'IMPORT_QUARANTINE_EXPORT' }),
    );
  });
});
