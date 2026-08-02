import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MasterDataService } from './master-data.service';

const GLOBAL_ACTOR = {
  id: 1,
  username: 'platform-admin',
  roles: ['ADMIN'],
  permissions: ['manage-schools'],
  data_scope: { global: true },
};

const SCHOOL_ACTOR = {
  id: 2,
  username: 'school-director',
  roles: ['DIRECTOR'],
  permissions: ['manage-schools'],
  data_scope: { school_ids: [1001] },
};

const SCHOOL_ROW = {
  id: 1001,
  name: 'โรงเรียนหนึ่ง',
  province: 'เชียงใหม่',
  district: 'เมืองเชียงใหม่',
  sub_district: 'สุเทพ',
  school_status: 'ACTIVE',
};

describe('MasterDataService', () => {
  function setup() {
    const repository = {
      listRows: jest.fn(),
      listRowsPaginated: jest.fn(),
      findRowById: jest.fn(),
      createRow: jest.fn(),
      createCodedRow: jest.fn(),
      updateRow: jest.fn(),
      updateCodedRow: jest.fn(),
      deleteRow: jest.fn(),
      listSchools: jest.fn(),
      findSchoolById: jest.fn(),
      createSchool: jest.fn(),
      createDefaultSchoolRoleGroups: jest.fn(),
      updateSchool: jest.fn(),
      disableSchool: jest.fn(),
      withTransaction: jest.fn(async (operation: (queryRunner: unknown) => Promise<unknown>) =>
        operation({ query: jest.fn() }),
      ),
    };
    const auditLog = { record: jest.fn(), recordAtomic: jest.fn() };

    return {
      service: new MasterDataService(repository as never, auditLog as never),
      repository,
      auditLog,
    };
  }

  it('keeps the legacy label/name create path for existing simple tables', async () => {
    const { service, repository } = setup();
    repository.createRow.mockResolvedValue({ id: 1, label: 'ยากจน' });

    await expect(service.create('risk_factors', { label: ' ยากจน ' })).resolves.toEqual({
      id: 1,
      label: 'ยากจน',
    });

    expect(repository.createRow).toHaveBeenCalledWith('risk_factors', 'label', 'ยากจน');
    expect(repository.createCodedRow).not.toHaveBeenCalled();
  });

  it('creates coded lookup rows through the coded whitelist path', async () => {
    const { service, repository } = setup();
    repository.createCodedRow.mockResolvedValue({
      id: '1',
      code: 'สพฐ',
      name: 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน',
      is_active: true,
    });

    await service.create('school_affiliations', {
      code: ' สพฐ ',
      name: ' สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน ',
      note: ' ',
      is_active: true,
    });

    expect(repository.createCodedRow).toHaveBeenCalledWith('school_affiliations', {
      code: 'สพฐ',
      name: 'สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน',
      note: null,
      is_active: true,
    });
  });

  it('requires a category when writing absence reasons', async () => {
    const { service } = setup();

    await expect(
      service.create('absence_reasons', {
        code: 'SICK',
        name: 'เจ็บป่วย',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates coded lookup rows through the coded whitelist path', async () => {
    const { service, repository } = setup();
    repository.updateCodedRow.mockResolvedValue({
      id: '2',
      code: 'VISUAL',
      name: 'ความบกพร่องทางการเห็น',
      legal_category: 'ความพิการทางการเห็น',
    });

    await service.update('disability_types', 2, {
      code: 'VISUAL',
      name: 'ความบกพร่องทางการเห็น',
      legal_category: ' ความพิการทางการเห็น ',
    });

    expect(repository.updateCodedRow).toHaveBeenCalledWith('disability_types', 2, {
      code: 'VISUAL',
      name: 'ความบกพร่องทางการเห็น',
      note: undefined,
      is_active: undefined,
      legal_category: 'ความพิการทางการเห็น',
    });
  });

  it('lists schools with the authenticated scope in the repository query', async () => {
    const { service, repository } = setup();
    repository.listSchools.mockResolvedValue({ rows: [SCHOOL_ROW], totalCount: 1 });

    await expect(service.listSchools(SCHOOL_ACTOR, { page: 1, limit: 20 })).resolves.toEqual({
      rows: [
        {
          id: 1001,
          name: 'โรงเรียนหนึ่ง',
          province: 'เชียงใหม่',
          district: 'เมืองเชียงใหม่',
          subDistrict: 'สุเทพ',
          schoolStatus: 'ACTIVE',
        },
      ],
      totalCount: 1,
      page: 1,
      limit: 20,
    });
    expect(repository.listSchools).toHaveBeenCalledWith(
      { page: 1, limit: 20, searchTerm: undefined },
      { school_ids: [1001] },
    );
  });

  it('fails closed for missing permission, empty scope, and cross-school reads', async () => {
    const { service, repository } = setup();
    await expect(
      service.listSchools({ ...SCHOOL_ACTOR, permissions: [] }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listSchools({ ...SCHOOL_ACTOR, data_scope: {} }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);

    repository.findSchoolById.mockResolvedValue(null);
    await expect(service.getSchool(SCHOOL_ACTOR, 2002)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findSchoolById).toHaveBeenCalledWith(2002, { school_ids: [1001] });
  });

  it('allows a scoped actor to update only a school returned by the scoped query', async () => {
    const { service, repository, auditLog } = setup();
    repository.findSchoolById.mockResolvedValue(SCHOOL_ROW);
    repository.updateSchool.mockResolvedValue({ ...SCHOOL_ROW, name: 'โรงเรียนหนึ่งใหม่' });

    await expect(
      service.updateSchool(SCHOOL_ACTOR, 1001, { name: 'โรงเรียนหนึ่งใหม่' }),
    ).resolves.toMatchObject({ id: 1001, name: 'โรงเรียนหนึ่งใหม่' });
    expect(repository.findSchoolById).toHaveBeenCalledWith(
      1001,
      { school_ids: [1001] },
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 2,
        targetType: 'schools',
        targetId: '1001',
        metadata: { op: 'update', changedFields: ['name'] },
      }),
      expect.anything(),
    );
  });

  it('reserves create and disable for explicit global scope', async () => {
    const { service, repository, auditLog } = setup();
    await expect(
      service.createSchool(SCHOOL_ACTOR, { id: 2002, name: 'โรงเรียนใหม่' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.disableSchool(SCHOOL_ACTOR, 1001)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    repository.createSchool.mockResolvedValue(SCHOOL_ROW);
    await expect(
      service.createSchool(GLOBAL_ACTOR, { id: 1001, name: SCHOOL_ROW.name }),
    ).resolves.toMatchObject({ id: 1001, schoolStatus: 'ACTIVE' });
    expect(repository.createSchool).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({ name: SCHOOL_ROW.name }),
      1,
      expect.anything(),
    );
    expect(repository.createDefaultSchoolRoleGroups).toHaveBeenCalledWith(
      SCHOOL_ROW.id,
      expect.anything(),
    );
    repository.findSchoolById.mockResolvedValue(SCHOOL_ROW);
    repository.disableSchool.mockResolvedValue({ ...SCHOOL_ROW, school_status: 'INACTIVE' });
    await expect(service.disableSchool(GLOBAL_ACTOR, 1001)).resolves.toMatchObject({
      id: 1001,
      schoolStatus: 'INACTIVE',
    });
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { op: 'disable', changedFields: ['schoolStatus'] } }),
      expect.anything(),
    );
  });
});
