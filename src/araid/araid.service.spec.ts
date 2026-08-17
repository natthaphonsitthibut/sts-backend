import { UnauthorizedException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { PasswordService } from '../auth/password.service';
import { AraIdIdentityRecordEntity, AraIdProfileEntity } from '../database/entities/araid.entities';
import { AraIdService } from './araid.service';

function recordFixture(): AraIdIdentityRecordEntity {
  return {
    id: '27c1d281-2b6f-44fd-a220-c5099a10c5cd',
    identityNumber: '1234567890123',
    titleTh: 'นาย',
    givenNameTh: 'อารา',
    familyNameTh: 'ไอดี',
    givenNameEn: null,
    familyNameEn: null,
    dateOfBirth: null,
    genderCode: null,
    phoneNumber: null,
    emailAddress: null,
    addressLine: null,
    subDistrictName: null,
    districtName: null,
    provinceName: null,
    postalCode: null,
    recordStatus: 'ACTIVE',
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  };
}

function profileFixture(overrides: Partial<AraIdProfileEntity> = {}): AraIdProfileEntity {
  return {
    id: '5bf79a94-e722-4809-86ce-726e87cd6e75',
    identityRecordId: '27c1d281-2b6f-44fd-a220-c5099a10c5cd',
    createdByUserId: 1,
    pinHash: '$hash',
    registrationStatus: 'ACTIVE',
    registrationMethod: 'MANAGED',
    failedPinAttempts: 0,
    pinLockedUntil: null,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AraIdService login', () => {
  const records = {
    findOne: jest.fn<(...args: unknown[]) => Promise<AraIdIdentityRecordEntity | null>>(),
  };
  const profiles = {
    findOne: jest.fn<(...args: unknown[]) => Promise<AraIdProfileEntity | null>>(),
    save: jest.fn((profile: AraIdProfileEntity) => Promise.resolve(profile)),
  };
  const passwordService = {
    compare: jest.fn<(plain: string, hash: string) => Promise<boolean>>(),
  };
  let service: AraIdService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AraIdService(
      records as unknown as Repository<AraIdIdentityRecordEntity>,
      profiles as unknown as Repository<AraIdProfileEntity>,
      {} as DataSource,
      passwordService as unknown as PasswordService,
    );
  });

  it('returns database-backed profile data without exposing the full identity number', async () => {
    records.findOne.mockResolvedValue(recordFixture());
    profiles.findOne.mockResolvedValue(profileFixture());
    passwordService.compare.mockResolvedValue(true);

    const result = await service.login('1234567890123', '12345678');

    expect(passwordService.compare).toHaveBeenCalledWith('12345678', '$hash');
    expect(result.givenNameTh).toBe('อารา');
    expect(result.identityNumberMasked).toBe('x-xxxx-xxxxx-23-x');
    expect(result).not.toHaveProperty('identityNumber');
  });

  it('uses one generic error when the identity number does not exist', async () => {
    records.findOne.mockResolvedValue(null);

    await expect(service.login('1234567890123', '12345678')).rejects.toEqual(
      new UnauthorizedException('เลขประจำตัวหรือ PIN ไม่ถูกต้อง'),
    );
  });

  it('locks the profile after five incorrect PIN attempts', async () => {
    const profile = profileFixture({ failedPinAttempts: 4 });
    records.findOne.mockResolvedValue(recordFixture());
    profiles.findOne.mockResolvedValue(profile);
    passwordService.compare.mockResolvedValue(false);

    await expect(service.login('1234567890123', '87654321')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(profile.failedPinAttempts).toBe(5);
    expect(profile.registrationStatus).toBe('LOCKED');
    expect(profile.pinLockedUntil).toBeInstanceOf(Date);
    expect(profiles.save).toHaveBeenCalledWith(profile);
  });

  it('requires the current AraID profile PIN again for step-up verification', async () => {
    const profile = profileFixture({
      failedPinAttempts: 2,
      pinLockedUntil: new Date(Date.now() - 1_000),
    });
    profiles.findOne.mockResolvedValue(profile);
    records.findOne.mockResolvedValue(recordFixture());
    passwordService.compare.mockResolvedValue(true);

    await expect(service.reauthenticate(profile.id, '12345678')).resolves.toBeUndefined();

    expect(passwordService.compare).toHaveBeenCalledWith('12345678', '$hash');
    expect(profile.failedPinAttempts).toBe(0);
    expect(profile.pinLockedUntil).toBeNull();
    expect(profiles.save).toHaveBeenCalledWith(profile);
  });

  it('reactivates an expired PIN lock during step-up verification', async () => {
    const profile = profileFixture({
      registrationStatus: 'LOCKED',
      failedPinAttempts: 5,
      pinLockedUntil: new Date(Date.now() - 1_000),
    });
    profiles.findOne.mockResolvedValue(profile);
    records.findOne.mockResolvedValue(recordFixture());
    passwordService.compare.mockResolvedValue(true);

    await expect(service.reauthenticate(profile.id, '12345678')).resolves.toBeUndefined();

    expect(profile).toMatchObject({
      registrationStatus: 'ACTIVE',
      failedPinAttempts: 0,
      pinLockedUntil: null,
    });
    expect(profiles.save).toHaveBeenCalledWith(profile);
  });

  it('returns the full identity number only through the server-side verified claim', async () => {
    profiles.findOne.mockResolvedValue(profileFixture());
    records.findOne.mockResolvedValue(recordFixture());

    await expect(
      service.getVerifiedIdentityNumber('5bf79a94-e722-4809-86ce-726e87cd6e75'),
    ).resolves.toBe('1234567890123');

    expect(profiles.findOne).toHaveBeenCalledWith({
      where: { id: '5bf79a94-e722-4809-86ce-726e87cd6e75' },
    });
    expect(records.findOne).toHaveBeenCalledWith({
      where: {
        id: '27c1d281-2b6f-44fd-a220-c5099a10c5cd',
        recordStatus: 'ACTIVE',
      },
    });
  });

  it('rejects the server-side identity claim for an inactive AraID session', async () => {
    profiles.findOne.mockResolvedValue(profileFixture({ registrationStatus: 'LOCKED' }));

    await expect(
      service.getVerifiedIdentityNumber('5bf79a94-e722-4809-86ce-726e87cd6e75'),
    ).rejects.toEqual(new UnauthorizedException('เซสชัน AraID ไม่ถูกต้อง'));

    expect(records.findOne).not.toHaveBeenCalled();
  });
});

describe('AraIdService management', () => {
  it('paginates records and masks identity numbers in list responses', async () => {
    const builder = {
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      andWhere: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([[recordFixture()], 1]),
    };
    for (const method of ['orderBy', 'addOrderBy', 'andWhere', 'skip', 'take'] as const) {
      builder[method].mockReturnValue(builder);
    }
    const records = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
    };
    const service = new AraIdService(
      records as unknown as Repository<AraIdIdentityRecordEntity>,
      {} as Repository<AraIdProfileEntity>,
      {} as DataSource,
      {} as PasswordService,
    );

    const result = await service.listRecords({ page: 2, limit: 10, search: 'อารา' });

    expect(builder.skip).toHaveBeenCalledWith(10);
    expect(builder.take).toHaveBeenCalledWith(10);
    expect(result.records[0]).toMatchObject({
      identityNumberMasked: 'x-xxxx-xxxxx-23-x',
      givenNameTh: 'อารา',
    });
    expect(result.records[0]).not.toHaveProperty('identityNumber');
    expect(result.meta).toMatchObject({ page: 2, limit: 10, totalCount: 1 });
  });

  it('deactivates the identity record and its login profile in one transaction', async () => {
    const record = recordFixture();
    const profile = profileFixture({ failedPinAttempts: 3 });
    const recordRepository = {
      findOne: jest.fn().mockResolvedValue(record),
      save: jest.fn((value: AraIdIdentityRecordEntity) => Promise.resolve(value)),
    };
    const profileRepository = {
      findOne: jest.fn().mockResolvedValue(profile),
      save: jest.fn((value: AraIdProfileEntity) => Promise.resolve(value)),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === AraIdIdentityRecordEntity ? recordRepository : profileRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn((operation: (transactionManager: typeof manager) => Promise<unknown>) =>
        operation(manager),
      ),
    };
    const service = new AraIdService(
      {} as Repository<AraIdIdentityRecordEntity>,
      {} as Repository<AraIdProfileEntity>,
      dataSource as unknown as DataSource,
      {} as PasswordService,
    );

    await service.updateRecordStatus(9, record.id, 'INACTIVE');

    expect(record).toMatchObject({ recordStatus: 'INACTIVE', updatedByUserId: 9 });
    expect(profile).toMatchObject({
      registrationStatus: 'REVOKED',
      failedPinAttempts: 0,
      pinLockedUntil: null,
    });
    expect(recordRepository.save).toHaveBeenCalledWith(record);
    expect(profileRepository.save).toHaveBeenCalledWith(profile);
  });
});
