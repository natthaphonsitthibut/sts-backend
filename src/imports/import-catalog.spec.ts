import * as xlsx from 'xlsx';
import type { AuthenticatedRequestUser } from '../auth';
import { getImportCatalog } from './import-catalog';
import { ImportsService } from './imports.service';

const ACTOR: AuthenticatedRequestUser = {
  id: 11,
  username: 'school-admin',
  roles: ['ADMIN'],
  permissions: ['import-data', 'import-data'],
  data_scope: { global: true },
};

function importFile(rows: Record<string, unknown>[]): Express.Multer.File {
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return {
    buffer: xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer,
    originalname: 'structure.xlsx',
  } as Express.Multer.File;
}

describe('canonical import catalog', () => {
  it('publishes dependency order, canonical contexts and actor capabilities', () => {
    const catalog = getImportCatalog(ACTOR);
    expect(catalog.targets.map((target) => target.target)).toEqual([
      'school_teacher_membership',
      'school_classroom',
      'student_term',
    ]);
    expect(catalog.targets.every((target) => target.allowed)).toBe(true);
    expect(
      catalog.targets.find((target) => target.target === 'school_classroom')?.dependsOn,
    ).toEqual(['school_teacher_membership']);
    const studentTarget = catalog.targets.find((target) => target.target === 'student_term');
    expect(studentTarget?.fields.find((field) => field.key === 'student_number')).toMatchObject({
      label: 'รหัสประจำตัวนักเรียน',
      required: false,
    });
    expect(studentTarget?.fields.find((field) => field.key === 'PersonID_Onec')).toMatchObject({
      required: true,
      referenceSource: null,
    });
    expect(
      studentTarget?.fields.find((field) => field.key === 'PersonID_Onec')?.aliases,
    ).not.toContain('รหัสนักเรียน');
    expect(
      catalog.targets
        .find((target) => target.target === 'school_classroom')
        ?.fields.map((field) => field.key),
    ).toEqual(['gradeLevelId', 'roomCode', 'roomName']);
  });

  it.each(['*', 'ALL'])(
    'marks %s wildcard actors as allowed using the shared permission resolver',
    (wildcard) => {
      const catalog = getImportCatalog({ roles: ['ADMIN'], permissions: [wildcard] });
      expect(catalog.targets.every((target) => target.allowed)).toBe(true);
    },
  );

  // Teacher and student imports share the นำเข้าข้อมูล page, so the check that
  // still matters is an actor who does not hold that page at all.
  it('fails closed for an actor without the นำเข้าข้อมูล permission', async () => {
    const service = new ImportsService({} as never, { recordAtomic: jest.fn() } as never);

    await expect(
      service.previewCatalogImport(
        importFile([{ citizenId: '1100000000011' }]),
        'school_teacher_membership',
        '{}',
        {
          ...ACTOR,
          permissions: ['students'],
        },
        { schoolId: 1001 },
      ),
    ).rejects.toThrow('ไม่มีสิทธิ์นำเข้าข้อมูลประเภทนี้');
  });

  it('commits a classroom once and skips an identical rerun', async () => {
    const existingClassrooms: Array<Record<string, unknown>> = [];
    let batchSequence = 0;
    const repository = {
      findSchoolScopeDetails: jest
        .fn()
        .mockResolvedValue([{ id: 1001, province: null, district: null, sub_district: null }]),
      findSchoolTermImportContext: jest
        .fn()
        .mockResolvedValue({ school_id: 1001, school_term_id: '77' }),
      findGradeLabels: jest.fn().mockResolvedValue([{ id: 101, label: 'ป.1' }]),
      findClassroomImportReferences: jest.fn(() => Promise.resolve([...existingClassrooms])),
      createImportBatch: jest.fn(() => Promise.resolve(`batch-${++batchSequence}`)),
      withTransaction: jest.fn(async (callback: (executor: never) => Promise<unknown>) =>
        callback({} as never),
      ),
      insertClassroomImportRow: jest.fn((input: Record<string, unknown>) => {
        existingClassrooms.push({
          id: '501',
          grade_level_id: input.gradeLevelId,
          room_code: input.roomCode,
          room_name: input.roomName,
          legacy_room_number: Number(input.roomCode),
        });
        return Promise.resolve('501');
      }),
      quarantineImportRow: jest.fn(),
      completeImportBatch: jest.fn(),
      failImportBatch: jest.fn(),
    };
    const auditLog = { recordAtomic: jest.fn() };
    const service = new ImportsService(repository as never, auditLog as never);
    const file = importFile([{ gradeLevelId: 101, roomCode: '1', roomName: 'ป.1/1' }]);
    const context = { schoolId: 1001, schoolTermId: 77 };

    const first = await service.processCatalogImport(
      file,
      'school_classroom',
      '{}',
      ACTOR,
      {},
      context,
    );
    const second = await service.processCatalogImport(
      file,
      'school_classroom',
      '{}',
      ACTOR,
      {},
      context,
    );

    expect(first).toMatchObject({ rowsInserted: 1, rowsSkipped: 0, rowsQuarantined: 0 });
    expect(second).toMatchObject({ rowsInserted: 0, rowsSkipped: 1, rowsQuarantined: 0 });
    expect(repository.insertClassroomImportRow).toHaveBeenCalledTimes(1);
    expect(auditLog.recordAtomic).toHaveBeenCalledTimes(2);
  });
});
