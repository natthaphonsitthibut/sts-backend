import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MasterDataService } from './master-data.service';

const ACTOR = {
  id: 1,
  username: 'global-admin',
  roles: ['ADMIN'],
  permissions: ['master-data'],
  data_scope: { global: true },
};

const CODED_ROW = {
  code: 'MINOR_ILLNESS',
  label_th: 'ป่วยไม่รุนแรง',
  sort_order: 10,
  is_active: true,
  category_code: 'PERSONAL_FAMILY',
  category_label_th: 'สาเหตุส่วนตัว / ครอบครัว',
  source_onec_code: null,
  requires_detail: null,
  usage_count: 3,
};

describe('MasterDataService', () => {
  function setup() {
    const runner = { query: jest.fn() };
    const repository = {
      getDefinition: jest.fn((catalog: string) => ({
        ...(catalog === 'absence-reasons'
          ? {
              categoryColumn: 'category_code',
              categoryCatalog: 'absence-reason-categories',
            }
          : {}),
      })),
      listCoded: jest.fn(),
      findCoded: jest.fn(),
      createCoded: jest.fn(),
      updateCoded: jest.fn(),
      listReferralAgencies: jest.fn(),
      findReferralAgency: jest.fn(),
      createReferralAgency: jest.fn(),
      updateReferralAgency: jest.fn(),
      withTransaction: jest.fn(async (operation: (value: unknown) => Promise<unknown>) =>
        operation(runner),
      ),
    };
    const auditLog = { recordAtomic: jest.fn() };
    return {
      service: new MasterDataService(repository as never, auditLog as never),
      repository,
      auditLog,
      runner,
    };
  }

  it('returns an explicit paginated response and hides NONE from consumer options', async () => {
    const { service, repository } = setup();
    repository.listCoded.mockResolvedValueOnce({ rows: [CODED_ROW], totalCount: 1 });
    await expect(service.listCoded('absence-reasons', { page: 1, limit: 20 })).resolves.toEqual({
      data: [
        {
          code: 'MINOR_ILLNESS',
          labelTh: 'ป่วยไม่รุนแรง',
          sortOrder: 10,
          isActive: true,
          categoryCode: 'PERSONAL_FAMILY',
          categoryLabelTh: 'สาเหตุส่วนตัว / ครอบครัว',
          sourceOnecCode: null,
          requiresDetail: null,
          usageCount: 3,
        },
      ],
      meta: { page: 1, limit: 20, totalCount: 1, totalPages: 1 },
    });

    repository.listCoded.mockResolvedValueOnce({
      rows: [CODED_ROW, { ...CODED_ROW, code: 'NONE', label_th: 'ไม่มี' }],
      totalCount: 2,
    });
    await expect(service.listActiveOptions('disadvantage-types')).resolves.toEqual([
      {
        code: 'MINOR_ILLNESS',
        labelTh: 'ป่วยไม่รุนแรง',
        categoryCode: 'PERSONAL_FAMILY',
        categoryLabelTh: 'สาเหตุส่วนตัว / ครอบครัว',
        requiresDetail: null,
      },
    ]);
  });

  it('validates catalog-specific fields and unknown catalog names', async () => {
    const { service } = setup();
    await expect(
      service.createCoded(ACTOR as never, 'absence-reasons', {
        code: 'NEW_REASON',
        labelTh: 'เหตุใหม่',
        sortOrder: 20,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(() => service.resolveCatalog('made-up-table')).toThrow(NotFoundException);
  });

  it('keeps UNKNOWN active and writes normal changes atomically with audit', async () => {
    const { service, repository, auditLog, runner } = setup();
    repository.findCoded.mockResolvedValue(CODED_ROW);
    await service.updateCoded(ACTOR, 'absence-reasons', 'MINOR_ILLNESS', {
      labelTh: 'ป่วยเล็กน้อย',
    });
    expect(repository.updateCoded).toHaveBeenCalledWith(
      'absence-reasons',
      'MINOR_ILLNESS',
      expect.objectContaining({ labelTh: 'ป่วยเล็กน้อย', actorId: 1 }),
      runner,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MASTER_DATA_EDIT' }),
      runner,
    );

    repository.findCoded.mockResolvedValue({ ...CODED_ROW, code: 'UNKNOWN' });
    await expect(
      service.disableCoded(ACTOR as never, 'absence-reasons', 'UNKNOWN'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects inactive parents but permits editing an unchanged legacy relation', async () => {
    const { service, repository, runner } = setup();
    repository.findCoded.mockImplementation((catalog: string) =>
      Promise.resolve(
        catalog === 'absence-reason-categories' ? { ...CODED_ROW, is_active: false } : CODED_ROW,
      ),
    );

    await expect(
      service.createCoded(ACTOR as never, 'absence-reasons', {
        code: 'NEW_REASON',
        labelTh: 'เหตุใหม่',
        sortOrder: 20,
        categoryCode: 'PERSONAL_FAMILY',
      }),
    ).rejects.toThrow('ประเภทอ้างอิงถูกปิดใช้งานหรือไม่มีอยู่');

    await service.updateCoded(ACTOR, 'absence-reasons', 'MINOR_ILLNESS', {
      labelTh: 'แก้ชื่อโดยไม่เปลี่ยนหมวด',
    });
    expect(repository.updateCoded).toHaveBeenCalledWith(
      'absence-reasons',
      'MINOR_ILLNESS',
      expect.objectContaining({ categoryCode: 'PERSONAL_FAMILY' }),
      runner,
    );
  });
});
