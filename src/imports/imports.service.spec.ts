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

function bulkPersonMatches(
  identifiers: Array<{ identifierNormalized: string }>,
): Array<{ identifier_normalized: string; person_uuid: string }> {
  return identifiers.map((identifier) => ({
    identifier_normalized: identifier.identifierNormalized,
    person_uuid: `${identifier.identifierNormalized}-person`,
  }));
}

function quarantineLookupMocks() {
  return {
    findQuarantineReasonLookups: jest.fn().mockResolvedValue([
      { code: 'IDENTIFIER_CONFLICT', label_th: 'เลขนี้ตรงกับหลายโปรไฟล์ในระบบ' },
      { code: 'MISSING_NATURAL_KEY_FIELD', label_th: 'ข้อมูลภาคเรียนบังคับไม่ครบหรือไม่ถูกต้อง' },
      { code: 'ROOM_NOT_FOUND', label_th: 'ไม่พบห้องเรียนในข้อมูลหลัก' },
    ]),
    findQuarantineResolutionStateLookups: jest.fn().mockResolvedValue([
      { code: 'ACTION_REQUIRED', label_th: 'ต้องแก้ข้อมูล', badge_variant: 'warning' },
      { code: 'DECISION_REQUIRED', label_th: 'ต้องตัดสินใจ', badge_variant: 'default' },
      { code: 'RETRY_ELIGIBLE', label_th: 'ผ่านการตรวจเบื้องต้น', badge_variant: 'success' },
      { code: 'BLOCKED', label_th: 'ต้องตรวจสอบเพิ่มเติม', badge_variant: 'secondary' },
    ]),
    findQuarantineStatusLookups: jest.fn().mockResolvedValue([
      { code: 'PENDING', label_th: 'รอตรวจสอบ', badge_variant: 'warning' },
      { code: 'RESOLVED', label_th: 'แก้ไขแล้ว', badge_variant: 'success' },
      { code: 'REJECTED', label_th: 'ปฏิเสธแล้ว', badge_variant: 'secondary' },
    ]),
  };
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
      ...quarantineLookupMocks(),
    };
    const auditLog = {
      record: jest.fn(),
      recordAtomic: jest.fn(),
    };

    return {
      repository,
      auditLog,
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
      personIdMasked: '•••••••••••••',
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
    expect(preview.mappedColumnSamples.PassportNumber_Onec).toEqual(['••••••••••••••••••']);
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
    expect(preview.sampleRows[1].issues).toContain('รหัสห้องไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
  });

  it('quarantines a well-formed room reference absent from canonical classrooms', async () => {
    const { repository, service } = createService();
    Object.assign(repository, {
      findExistingClassroomReferences: jest.fn().mockResolvedValue([]),
    });
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        SchoolID_Onec: 1001,
        AcademicYear_Onec: 2569,
        Semester_Onec: 1,
        GradeLevelID_Onec: 101,
        RoomID_Onec: 9,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({ rowsReady: 0, roomIssueRows: 1, rowsToQuarantine: 1 });
    expect(preview.sampleRows[0].issues).toContain('รหัสห้องไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
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

  it('injects the server-resolved school, term, and classroom into every preview row', async () => {
    const { repository, service } = createService();
    Object.assign(repository, {
      findSchoolRosterImportContext: jest.fn().mockResolvedValue({
        school_id: 1001,
        school_term_id: '21',
        classroom_id: '31',
        academic_year: 2569,
        semester: 1,
        grade_level_id: 101,
        legacy_room_number: 1,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        sub_district: 'สุเทพ',
      }),
      findExistingClassroomReferences: jest.fn().mockResolvedValue([
        {
          school_id: 1001,
          academic_year: 2569,
          semester: 1,
          grade_level_id: 101,
          room_number: 1,
        },
      ]),
    });
    const file = makeImportFile([
      {
        PersonID_Onec: '1111111111111',
        FirstName_Onec: 'นักเรียน',
        StudentStatusID_Onec: 10,
      },
    ]);

    const preview = await service.previewImport(
      file,
      'student_term',
      '{}',
      { id: 1, data_scope: { school_ids: [1001] } } as never,
      { schoolId: 1001, schoolTermId: 21, classroomId: 31 },
    );

    expect(preview).toMatchObject({
      canImport: true,
      missingRequiredColumns: [],
      rowsReady: 1,
      sampleRows: [
        {
          schoolId: '1001',
          academicYear: '2569',
          semester: '1',
          gradeLevelId: '101',
          roomId: '1',
        },
      ],
    });
    expect(
      (
        repository as typeof repository & {
          findSchoolRosterImportContext: jest.Mock;
        }
      ).findSchoolRosterImportContext,
    ).toHaveBeenCalledWith(1001, 21, 31);
  });

  it('rejects a canonical import context outside the authenticated school scope', async () => {
    const { repository, service } = createService();
    Object.assign(repository, {
      findSchoolRosterImportContext: jest.fn().mockResolvedValue({
        school_id: 1001,
        school_term_id: '21',
        classroom_id: '31',
        academic_year: 2569,
        semester: 1,
        grade_level_id: 101,
        legacy_room_number: 1,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        sub_district: 'สุเทพ',
      }),
    });
    const file = makeImportFile([{ PersonID_Onec: '1111111111111' }]);

    await expect(
      service.previewImport(
        file,
        'student_term',
        '{}',
        { id: 1, data_scope: { school_ids: [2002] } } as never,
        { schoolId: 1001, schoolTermId: 21, classroomId: 31 },
      ),
    ).rejects.toThrow('ไม่มีสิทธิ์นำเข้าข้อมูลโรงเรียน 1001');
  });

  it('previews teacher membership import with ready, existing, and quarantined rows', async () => {
    const { repository, service } = createService();
    repository.findSchoolScopeDetails.mockResolvedValue([
      {
        id: 1001,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        sub_district: 'สุเทพ',
      },
    ]);
    Object.assign(repository, {
      findTeacherImportCandidates: jest.fn().mockResolvedValue([
        {
          teacher_id: '11',
          citizen_id: '1100000000011',
          display_name: 'ครูพร้อม',
          is_eligible: true,
          is_active_member: false,
        },
        {
          teacher_id: '12',
          citizen_id: '1100000000012',
          display_name: 'ครูเดิม',
          is_eligible: true,
          is_active_member: true,
        },
        {
          teacher_id: '13',
          citizen_id: '1100000000013',
          display_name: 'ครูปิดใช้งาน',
          is_eligible: false,
          is_active_member: false,
        },
      ]),
    });
    const file = makeImportFile([
      { เลขประจำตัวประชาชน: '1100000000011', วันที่เริ่มปฏิบัติงาน: '2026-07-01' },
      { เลขประจำตัวประชาชน: '1100000000012' },
      { เลขประจำตัวประชาชน: '1100000000099' },
      { เลขประจำตัวประชาชน: '1100000000013' },
    ]);

    const preview = await service.previewTeacherImport(file, 1001, {
      id: 1,
      data_scope: { school_ids: [1001] },
    } as never);

    expect(preview).toMatchObject({
      target: 'school_teacher_membership',
      rowsProcessed: 4,
      rowsReady: 1,
      rowsSkipped: 1,
      rowsToQuarantine: 2,
    });
    // Both quarantined rows now show up in the sample, matching rowsToQuarantine.
    expect(preview.sampleRows.map((row) => row.action)).toEqual([
      'insert',
      'skip',
      'quarantine',
      'quarantine',
    ]);
  });

  it('preserves an ISO teacher start date from CSV', async () => {
    const { repository, service } = createService();
    repository.findSchoolScopeDetails.mockResolvedValue([
      {
        id: 1001,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        sub_district: 'สุเทพ',
      },
    ]);
    Object.assign(repository, {
      findTeacherImportCandidates: jest.fn().mockResolvedValue([
        {
          teacher_id: '11',
          citizen_id: '1100000000011',
          display_name: 'ครูพร้อม',
          is_eligible: true,
          is_active_member: false,
        },
      ]),
    });

    const preview = await service.previewTeacherImport(
      makeCsvImportFile('citizenId,startedOn\n1100000000011,2026-07-01\n'),
      1001,
      { id: 1, data_scope: { school_ids: [1001] } } as never,
    );

    expect(preview).toMatchObject({ rowsReady: 1, rowsToQuarantine: 0 });
  });

  it('commits valid teacher memberships and quarantines invalid accounts in one batch', async () => {
    const { repository, service, auditLog } = createService();
    repository.findSchoolScopeDetails.mockResolvedValue([
      {
        id: 1001,
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        sub_district: 'สุเทพ',
      },
    ]);
    const executor = { query: jest.fn() };
    Object.assign(repository, {
      createImportBatch: jest.fn().mockResolvedValue('batch-teachers'),
      withTransaction: jest.fn(async (operation: (value: unknown) => Promise<unknown>) =>
        operation(executor),
      ),
      findTeacherImportCandidates: jest.fn().mockResolvedValue([
        {
          teacher_id: '11',
          citizen_id: '1100000000011',
          display_name: 'ครูพร้อม',
          is_eligible: true,
          is_active_member: false,
        },
      ]),
      insertTeacherImportMembership: jest.fn().mockResolvedValue('51'),
      quarantineImportRow: jest.fn().mockResolvedValue(true),
      completeImportBatch: jest.fn().mockResolvedValue(undefined),
      failImportBatch: jest.fn().mockResolvedValue(undefined),
    });
    auditLog.recordAtomic = jest.fn().mockResolvedValue(undefined);
    const file = makeImportFile([{ citizenId: '1100000000011' }, { citizenId: '1100000000099' }]);

    await expect(
      service.processTeacherImport(file, 1001, {
        id: 1,
        username: 'director',
        data_scope: { school_ids: [1001] },
      } as never),
    ).resolves.toMatchObject({
      batchId: 'batch-teachers',
      rowsInserted: 1,
      rowsQuarantined: 1,
    });
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DATA_IMPORT',
        targetType: 'school_teacher_memberships',
      }),
      executor,
    );
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

    const automaticPreview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);
    expect(automaticPreview.canImport).toBe(true);
    expect(automaticPreview.headers).toEqual([
      'เลขบัตร',
      'ชื่อ',
      'นามสกุล',
      'ปีการศึกษา',
      'ภาคเรียน',
      'รหัสโรงเรียน',
    ]);
    expect(automaticPreview.mapping).toMatchObject({
      PersonID_Onec: 'เลขบัตร',
      FirstName_Onec: 'ชื่อ',
      LastName_Onec: 'นามสกุล',
      AcademicYear_Onec: 'ปีการศึกษา',
      Semester_Onec: 'ภาคเรียน',
      SchoolID_Onec: 'รหัสโรงเรียน',
    });

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
      personIdMasked: '•••••••••••••',
    });
  });

  it('auto-maps common name and id headers and splits a combined full name', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        ID: '3333333333333',
        'ชื่อ-นามสกุล': 'ณัฐพล สิทธิบุศย์',
        ปี: 2569,
        เทอม: 1,
        รหัสโรงเรียน: 1001,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview.mapping).toMatchObject({
      PersonID_Onec: 'ID',
      FullName_Onec: 'ชื่อ-นามสกุล',
      AcademicYear_Onec: 'ปี',
      Semester_Onec: 'เทอม',
      SchoolID_Onec: 'รหัสโรงเรียน',
    });
    expect(preview.sampleRows[0]).toMatchObject({
      firstName: 'ณัฐพล',
      lastName: 'สิทธิบุศย์',
      personIdMasked: '•••••••••••••',
    });
  });

  it('rejects mapping one source header to multiple system fields', async () => {
    const { service } = createService();
    const file = makeImportFile([
      {
        ชื่อ: 'ณัฐพล สิทธิบุศย์',
        ปี: 2569,
        เทอม: 1,
        รหัสโรงเรียน: 1001,
      },
    ]);

    await expect(
      service.previewImport(
        file,
        'student_term',
        JSON.stringify({ PersonID_Onec: 'ชื่อ', FirstName_Onec: 'ชื่อ' }),
        GLOBAL_ACTOR,
      ),
    ).rejects.toThrow('ถูกจับคู่มากกว่าหนึ่งช่อง');
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
      personIdMasked: '•••••••••••••',
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

  it('accepts CSV files at the 10,000-row import limit', async () => {
    const { service } = createService();
    const rows = Array.from(
      { length: 10_000 },
      (_, index) => `${String(index + 1).padStart(13, '0')},2567,1,1001`,
    );
    const file = makeCsvImportFile(
      ['PersonID_Onec,AcademicYear_Onec,Semester_Onec,SchoolID_Onec', ...rows].join('\n'),
    );

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({
      canImport: true,
      rowsProcessed: 10_000,
      rowsReady: 10_000,
      rowsToInsert: 10_000,
      rowsToQuarantine: 0,
    });
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

  it('treats a placeholder UNMAPPED-category status as still unmapped in preview', async () => {
    const { repository, service } = createService();
    repository.findStudentStatusLabels.mockResolvedValue([
      { id: 90, label: 'ยังไม่ได้จับคู่ (ตัวอย่าง)', category: 'UNMAPPED' },
    ]);
    const file = makeImportFile([
      {
        PersonID_Onec: '7777777777777',
        AcademicYear_Onec: 2567,
        Semester_Onec: 1,
        SchoolID_Onec: 1001,
        StudentStatusID_Onec: 90,
      },
    ]);

    const preview = await service.previewImport(file, 'student_term', '{}', GLOBAL_ACTOR);

    expect(preview).toMatchObject({ rowsReady: 0, rowsToQuarantine: 1 });
    expect(preview.sampleRows[0]).toMatchObject({
      status: 'quarantine',
      action: 'quarantine',
      studentStatusCode: '90',
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

  it('rejects dropout import preview targets', async () => {
    const { service } = createService();
    const file = makeImportFile([{ PersonID_Onec: 'DROPOUT-001', SchoolID_Onec: 2002 }]);

    await expect(
      service.previewImport(file, 'student_dropouts', '{}', GLOBAL_ACTOR),
    ).rejects.toThrow('Invalid target database');
  });

  it('rejects dropout bulk import targets', async () => {
    const { service } = createService();
    const file = makeImportFile([{ PersonID_Onec: 'DROPOUT-001', SchoolID_Onec: 2002 }]);

    await expect(
      service.processImport(file, 'student_dropouts', '{}', undefined, GLOBAL_ACTOR),
    ).rejects.toThrow('Invalid target database');
  });

  it('requires missing-school resolution before bulk import', async () => {
    const repository = {
      findExistingSchoolIds: jest.fn().mockResolvedValue([]),
      findSchoolScopeDetails: jest.fn().mockResolvedValue([]),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      bulkResolveOrCreatePersonsByNationalIds: jest.fn(bulkPersonMatches),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      bulkUpsertStudentTerms: jest.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
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

    await expect(
      service.processImport(
        file,
        'student_term',
        '{}',
        JSON.stringify([{ id: 2002, name: 'Resolved test school' }]),
        actor,
      ),
    ).rejects.toThrow('การนำเข้าไม่สามารถสร้างโรงเรียนใหม่ได้');
    expect(repository.withTransaction).not.toHaveBeenCalled();
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
      bulkResolveOrCreatePersonsByNationalIds: jest.fn(bulkPersonMatches),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      bulkUpsertStudentTerms: jest.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
      completeImportBatch: jest.fn(),
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
      bulkResolveOrCreatePersonsByNationalIds: jest.fn(bulkPersonMatches),
      bulkUpsertStudentTerms: jest.fn((rows: Record<string, unknown>[]) => {
        let inserted = 0;
        let updated = 0;
        for (const row of rows) {
          const key = JSON.stringify([
            row.person_uuid,
            row.AcademicYear_Onec,
            row.Semester_Onec,
            row.SchoolID_Onec,
          ]);
          if (writes.has(key)) {
            updated += 1;
            continue;
          }
          writes.add(key);
          inserted += 1;
        }
        return { inserted, updated };
      }),
      insertImportRow: jest.fn(),
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
    const notificationsService = {
      notifyImportCompleted: jest.fn(),
      notifyImportFailed: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      auditLog as never,
      notificationsService,
    );
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
    expect(repository.bulkResolveOrCreatePersonsByNationalIds).toHaveBeenCalledTimes(2);
    expect(repository.bulkUpsertStudentTerms).toHaveBeenCalledTimes(2);
    expect(repository.insertImportRow).not.toHaveBeenCalled();
    expect(repository.findPersonUuidMatchesByNationalIds).toHaveBeenCalledTimes(2);
    expect(auditLog.recordAtomic).toHaveBeenCalledTimes(2);
    const batchInput = (repository.createImportBatch.mock.calls[0] as unknown[])[0] as {
      scopeSnapshot: Record<string, unknown>;
    };
    expect(batchInput.scopeSnapshot).toMatchObject({ global: true, selectedSchoolIds: [1001] });
    const auditEvent = (auditLog.recordAtomic.mock.calls[0] as unknown[])[0] as {
      actorUserId: number;
      targetId: string;
      metadata: Record<string, unknown>;
    };
    expect(auditEvent).toMatchObject({ actorUserId: 1, targetId: 'batch-id' });
    expect(auditEvent.metadata).toMatchObject({
      batchId: 'batch-id',
      schoolId: 1001,
      schoolIds: [1001],
      rowsInserted: 2,
      rowsUpdated: 0,
      rowsQuarantined: 0,
    });
    expect(notificationsService.notifyImportCompleted).not.toHaveBeenCalled();
    expect(notificationsService.notifyImportFailed).not.toHaveBeenCalled();
  });

  it('writes canonical student status code for mapped import rows', async () => {
    const repository = {
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      bulkResolveOrCreatePersonsByNationalIds: jest.fn(bulkPersonMatches),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      bulkUpsertStudentTerms: jest.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
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

    expect(repository.bulkUpsertStudentTerms).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          StudentStatusID_Onec: 10,
          student_status_code: 10,
        }),
      ],
      expect.anything(),
    );
    expect(repository.insertImportRow).not.toHaveBeenCalled();
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
      bulkResolveOrCreatePersonsByNationalIds: jest.fn(bulkPersonMatches),
      insertImportRow: jest.fn().mockRejectedValue(new Error('database write failed')),
      bulkUpsertStudentTerms: jest.fn().mockRejectedValue(new Error('database write failed')),
      completeImportBatch: jest.fn(),
      failImportBatch: jest.fn(),
    };
    const auditLog = { record: jest.fn(), recordAtomic: jest.fn() };
    const notificationsService = {
      notifyImportCompleted: jest.fn(),
      notifyImportFailed: jest.fn(),
    };
    const service = new ImportsService(
      repository as never,
      auditLog as never,
      notificationsService,
    );
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
    expect(notificationsService.notifyImportFailed).not.toHaveBeenCalled();
    expect(notificationsService.notifyImportCompleted).not.toHaveBeenCalled();
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
      bulkResolveOrCreatePersonsByNationalIds: jest.fn().mockResolvedValue([]),
      insertImportRow: jest.fn(),
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

    expect(result).toMatchObject({ batchId: 'batch-id', rowsInserted: 0, rowsQuarantined: 1 });
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
      bulkResolveOrCreatePersonsByNationalIds: jest.fn().mockResolvedValue([]),
      insertImportRow: jest.fn(),
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
      ...quarantineLookupMocks(),
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
            changed_field_details: [{ label: 'ห้อง', oldValue: '99', newValue: '1' }],
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
    expect(result.items[0].student.personIdMasked).toBe('•••••••••••••');
    expect(result.items[0].changedFieldDetails).toEqual([
      { label: 'ห้อง', oldValue: '99', newValue: '1' },
    ]);
    expect(result.items[0].resolution).toMatchObject({
      state: 'DECISION_REQUIRED',
      action: 'SELECT_CANDIDATE',
    });
    expect(JSON.stringify(result)).not.toContain('1234567890123');
  });

  it('marks only invalid natural-key fields as editable', async () => {
    const repository = {
      ...quarantineLookupMocks(),
      listQuarantine: jest.fn().mockResolvedValue({
        rows: [
          {
            id: '2',
            batch_id: 'batch-id',
            school_id: 1001,
            school_name: 'Test School',
            source_row_number: 3,
            reason_code: 'MISSING_NATURAL_KEY_FIELD',
            status: 'PENDING',
            target: 'student_term',
            mapped_values: {
              PersonID_Onec: '1234567890123',
              FirstName_Onec: 'Test',
              LastName_Onec: 'Student',
              AcademicYear_Onec: 2569,
              Semester_Onec: 1,
              SchoolID_Onec: 'Test School',
            },
          },
        ],
        totalCount: 1,
      }),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    const result = await service.listQuarantine({ page: 1, limit: 20 }, {
      id: 1,
      data_scope: { global: true },
    } as never);

    expect(result.items[0].resolution).toMatchObject({
      state: 'ACTION_REQUIRED',
      action: 'EDIT_FIELDS',
      editableFields: ['SchoolID_Onec'],
    });
  });

  it('marks natural-key rows as retryable when the corrected values are complete', async () => {
    const repository = {
      ...quarantineLookupMocks(),
      listQuarantine: jest.fn().mockResolvedValue({
        rows: [
          {
            id: '3',
            batch_id: 'batch-id',
            school_id: 1001,
            school_name: 'Test School',
            source_row_number: 4,
            reason_code: 'MISSING_NATURAL_KEY_FIELD',
            status: 'PENDING',
            target: 'student_term',
            retry_eligible: true,
            mapped_values: {
              PersonID_Onec: '1234567890123',
              FirstName_Onec: 'Test',
              LastName_Onec: 'Student',
              AcademicYear_Onec: 2569,
              Semester_Onec: 1,
              SchoolID_Onec: 1001,
            },
          },
        ],
        totalCount: 1,
      }),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    const result = await service.listQuarantine({ page: 1, limit: 20 }, {
      id: 1,
      data_scope: { global: true },
    } as never);

    expect(result.items[0].resolution).toMatchObject({
      state: 'RETRY_ELIGIBLE',
      action: 'RETRY',
      editableFields: [],
    });
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
      ...quarantineLookupMocks(),
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
        school_name: 'Import School',
        school_province: 'Bangkok',
        source_grade_label: 'ป.1',
        source_status_label: 'กำลังศึกษา',
        mapped_values: {
          PersonID_Onec: '1234567890123',
          FirstName_Onec: 'Import',
          LastName_Onec: 'Student',
          SchoolID_Onec: 1001,
          GradeLevelID_Onec: 101,
          RoomID_Onec: 1,
          AcademicYear_Onec: 2569,
          Semester_Onec: 1,
          StudentStatusID_Onec: 10,
        },
      }),
      findPersonCandidateDetailsByNationalId: jest.fn().mockResolvedValue([
        {
          person_uuid: 'person-a',
          first_name: 'A',
          last_name: 'One',
          school_name: 'Candidate School',
          school_province: 'Bangkok',
          grade_level_id: 101,
          grade_level_label: 'ป.1',
          room_id: '2',
          academic_year: '2569',
          semester: '1',
          student_status_code: 10,
          student_status_label: 'กำลังศึกษา',
        },
      ]),
      countPersonCandidatesByNationalId: jest.fn().mockResolvedValue(2),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    const result = await service.listQuarantineCandidates('1', {
      id: 1,
      data_scope: { school_ids: [1001] },
    } as never);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      candidateKey: candidateKey('1', 'person-a'),
      personIdMasked: '•••••••••••••',
      schoolName: 'Candidate School',
      roomId: '2',
    });
    expect(result.meta).toEqual({ totalCount: 2, visibleCount: 1 });
    expect(result.importRow).toMatchObject({
      firstName: 'Import',
      schoolName: 'Import School',
      gradeLevelLabel: 'ป.1',
      roomId: '1',
    });
    expect(repository.findPersonCandidateDetailsByNationalId).toHaveBeenCalledWith(
      '1234567890123',
      { school_ids: [1001] },
      expect.anything(),
    );
    expect(repository.countPersonCandidatesByNationalId).toHaveBeenCalledWith(
      '1234567890123',
      expect.anything(),
    );
    expect(JSON.stringify(result)).not.toContain('person-a');
    expect(JSON.stringify(result)).not.toContain('1234567890123');
  });

  it('corrects an allowed quarantine field and resolves atomically', async () => {
    const auditLog = { recordAtomic: jest.fn() };
    const repository = {
      ...quarantineLookupMocks(),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findQuarantineForUpdate: jest.fn().mockResolvedValue({
        id: '7',
        status: 'PENDING',
        reason_code: 'ROOM_NOT_FOUND',
        target: 'student_term',
        mapped_values: {
          PersonID_Onec: '1234567890123',
          AcademicYear_Onec: 2569,
          Semester_Onec: 1,
          SchoolID_Onec: 1001,
          GradeLevelID_Onec: 101,
          RoomID_Onec: 'bad',
        },
      }),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: 'Bangkok', district: null, sub_district: null }]),
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findGradeLabels: jest.fn().mockResolvedValue([{ id: 101, label: 'ป.1' }]),
      findPersonUuidMatchesByNationalIds: jest
        .fn()
        .mockResolvedValue([{ identifier_normalized: '1234567890123', person_uuid: 'person-a' }]),
      insertImportRow: jest.fn().mockResolvedValue('inserted'),
      updateQuarantineMappedValues: jest.fn(),
      resolveQuarantineRow: jest.fn(),
    };
    const service = new ImportsService(repository as never, auditLog as never);

    const result = await service.fixQuarantineValues(
      '7',
      { values: { AcademicYear_Onec: undefined, RoomID_Onec: '2' } },
      {
        id: 1,
        data_scope: { global: true },
      } as never,
    );

    expect(result).toEqual({ id: '7', status: 'RESOLVED', changedFields: ['RoomID_Onec'] });
    expect(repository.insertImportRow).toHaveBeenCalledWith(
      'student_term',
      expect.objectContaining({
        AcademicYear_Onec: 2569,
        RoomID_Onec: '2',
        person_uuid: 'person-a',
      }),
      expect.anything(),
    );
    expect(repository.updateQuarantineMappedValues).toHaveBeenCalledWith(
      '7',
      expect.any(Object),
      1001,
      1,
      expect.anything(),
    );
    const auditCall = (auditLog.recordAtomic.mock.calls[0] as unknown[])[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditCall.action).toBe('IMPORT_QUARANTINE_RESOLVED');
    expect(auditCall.metadata).toMatchObject({
      status: 'RESOLVED',
      statusLabel: 'แก้ไขแล้ว',
      reasonCode: 'ROOM_NOT_FOUND',
      reasonLabel: 'ไม่พบห้องเรียนในข้อมูลหลัก',
      changedFields: ['RoomID_Onec'],
      changedFieldDetails: [
        {
          field: 'RoomID_Onec',
          label: 'ห้อง',
          oldValue: 'bad',
          newValue: '2',
        },
      ],
      changedFieldLabels: 'ห้อง',
    });
  });

  it('rejects resolving a quarantine row against a placeholder UNMAPPED-category status', async () => {
    const repository = {
      ...quarantineLookupMocks(),
      withTransaction: jest.fn(async (callback: (executor: unknown) => Promise<unknown>) =>
        callback({ query: jest.fn() }),
      ),
      findQuarantineForUpdate: jest.fn().mockResolvedValue({
        id: '22',
        status: 'PENDING',
        reason_code: 'UNMAPPED_STUDENT_STATUS',
        target: 'student_term',
        mapped_values: {
          PersonID_Onec: '1234567890123',
          AcademicYear_Onec: 2569,
          Semester_Onec: 1,
          SchoolID_Onec: 1001,
          StudentStatusID_Onec: 90,
        },
      }),
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: 'Bangkok', district: null, sub_district: null }]),
      findExistingSchoolIds: jest.fn().mockResolvedValue([1001]),
      findStudentStatusLabels: jest
        .fn()
        .mockResolvedValue([{ id: 90, label: 'ยังไม่ได้จับคู่ (ตัวอย่าง)', category: 'UNMAPPED' }]),
      insertImportRow: jest.fn(),
      resolveQuarantineRow: jest.fn(),
    };
    const service = new ImportsService(repository as never, { recordAtomic: jest.fn() } as never);

    await expect(
      service.fixQuarantineValues('22', { values: { StudentStatusID_Onec: '90' } }, {
        id: 1,
        data_scope: { global: true },
      } as never),
    ).rejects.toThrow('สถานะนักเรียนยังไม่ได้จับคู่');
    expect(repository.insertImportRow).not.toHaveBeenCalled();
    expect(repository.resolveQuarantineRow).not.toHaveBeenCalled();
  });

  it('summarizes retryable quarantine rows within actor scope and filters', async () => {
    const repository = {
      countReadyQuarantineRows: jest.fn().mockResolvedValue(3),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);

    const result = await service.retryableQuarantineSummary(
      { reasonCode: 'GRADE_NOT_FOUND', schoolId: 1001 },
      { id: 1, data_scope: { school_ids: [1001] } } as never,
    );

    expect(result).toEqual({ readyCount: 3, batchLimit: 100 });
    expect(repository.countReadyQuarantineRows).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'GRADE_NOT_FOUND', schoolId: 1001 }),
      { school_ids: [1001] },
    );
  });

  it('denies retry summary and batch actions for own-only actors', async () => {
    const repository = {
      countReadyQuarantineRows: jest.fn(),
      findReadyQuarantineRows: jest.fn(),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);
    const actor = { id: 1, data_scope: { own_only: true } } as never;

    await expect(service.retryableQuarantineSummary({}, actor)).rejects.toThrow(
      'บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ',
    );
    await expect(service.retryReadyQuarantine({}, actor)).rejects.toThrow(
      'บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ',
    );
    expect(repository.countReadyQuarantineRows).not.toHaveBeenCalled();
    expect(repository.findReadyQuarantineRows).not.toHaveBeenCalled();
  });

  it('retries a bounded quarantine batch and is idempotent when no rows remain', async () => {
    const repository = {
      findReadyQuarantineRows: jest
        .fn()
        .mockResolvedValueOnce([
          { id: '1', sourceRowNumber: 11, studentName: 'ณัฐวุฒิ ใจตรง' },
          { id: '2', sourceRowNumber: 12, studentName: 'อรณิชา แสงแก้ว' },
        ])
        .mockResolvedValueOnce([]),
      countReadyQuarantineRows: jest.fn().mockResolvedValue(0),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);
    const resolve = jest.spyOn(service, 'resolveQuarantine').mockResolvedValue({
      id: '1',
      status: 'RESOLVED',
    });
    const actor = { id: 1, data_scope: { global: true } } as never;

    const first = await service.retryReadyQuarantine({}, actor);
    const second = await service.retryReadyQuarantine({}, actor);

    expect(first).toEqual({
      selectedCount: 2,
      processedCount: 2,
      skippedCount: 0,
      failedCount: 0,
      remainingReadyCount: 0,
      batchLimit: 100,
      items: [
        {
          id: '1',
          sourceRowNumber: 11,
          studentName: 'ณัฐวุฒิ ใจตรง',
          outcome: 'IMPORTED',
          code: 'IMPORTED',
          message: 'นำเข้าสำเร็จ',
        },
        {
          id: '2',
          sourceRowNumber: 12,
          studentName: 'อรณิชา แสงแก้ว',
          outcome: 'IMPORTED',
          code: 'IMPORTED',
          message: 'นำเข้าสำเร็จ',
        },
      ],
    });
    expect(second.selectedCount).toBe(0);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(repository.findReadyQuarantineRows).toHaveBeenCalledWith(
      expect.any(Object),
      { global: true },
      100,
    );
  });

  it('exports a scoped readable CSV with masked identifiers', async () => {
    const auditLog = { record: jest.fn() };
    const repository = {
      ...quarantineLookupMocks(),
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

    expect(csv).toContain('•••••••••••••');
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

  it('purges resolved/rejected quarantine rows past the 180-day retention window', async () => {
    let capturedCutoff: Date | undefined;
    const repository = {
      deleteResolvedQuarantineOlderThan: jest.fn((cutoff: Date) => {
        capturedCutoff = cutoff;
        return Promise.resolve(3);
      }),
    };
    const service = new ImportsService(repository as never, { record: jest.fn() } as never);
    const now = new Date('2026-07-05T00:00:00.000Z');

    const result = await service.cleanupExpiredQuarantine(now);

    expect(result).toEqual({ deleted: 3 });
    expect(repository.deleteResolvedQuarantineOlderThan).toHaveBeenCalledTimes(1);
    // Cutoff is 180 days before `now`.
    expect(capturedCutoff?.toISOString()).toBe('2026-01-06T00:00:00.000Z');
  });
});
