import { BadRequestException } from '@nestjs/common';
import { MasterDataService } from './master-data.service';

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
    };
    const auditLog = { record: jest.fn() };

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
});
