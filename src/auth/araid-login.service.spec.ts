import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';
import { AraIdLoginService } from './araid-login.service';

describe('AraIdLoginService', () => {
  let challengeStore: jest.Mocked<
    Pick<AraIdChallengeStore, 'approveAuthorization' | 'readAuthorization'>
  >;
  let araIdService: jest.Mocked<Pick<AraIdService, 'getVerifiedIdentityNumber'>>;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;
  let service: AraIdLoginService;

  beforeEach(() => {
    challengeStore = {
      approveAuthorization: jest.fn(),
      readAuthorization: jest.fn(),
    };
    araIdService = { getVerifiedIdentityNumber: jest.fn() };
    dataSource = { query: jest.fn() };
    service = new AraIdLoginService(
      challengeStore as unknown as AraIdChallengeStore,
      araIdService as unknown as AraIdService,
      dataSource as unknown as DataSource,
    );
  });

  it('requires a PIN authenticated after the challenge was claimed', async () => {
    challengeStore.readAuthorization.mockResolvedValue({
      challenge: {} as never,
      minimumAuthenticatedAt: 500,
    });

    await expect(service.approveChallenge('authorization', 'profile', 499)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(araIdService.getVerifiedIdentityNumber).not.toHaveBeenCalled();
  });

  it('approves exactly one active account in an assignable group', async () => {
    challengeStore.readAuthorization.mockResolvedValue({
      challenge: {} as never,
      minimumAuthenticatedAt: 500,
    });
    araIdService.getVerifiedIdentityNumber.mockResolvedValue('1-2345-67890-12-3');
    dataSource.query.mockResolvedValue([{ id: 42 }]);
    challengeStore.approveAuthorization.mockResolvedValue(true);

    await expect(service.approveChallenge('authorization', 'profile', 500)).resolves.toEqual({
      approved: true,
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('role_group.is_assignable IS TRUE'),
      ['1234567890123'],
    );
    expect(challengeStore.approveAuthorization).toHaveBeenCalledWith(
      'admin-login',
      'authorization',
      {
        userId: 42,
      },
    );
  });

  it('fails closed without revealing whether an identity has an account', async () => {
    challengeStore.readAuthorization.mockResolvedValue({
      challenge: {} as never,
      minimumAuthenticatedAt: 0,
    });
    araIdService.getVerifiedIdentityNumber.mockResolvedValue('1234567890123');
    dataSource.query.mockResolvedValue([]);

    await expect(service.approveChallenge('authorization', 'profile', 1)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(challengeStore.approveAuthorization).not.toHaveBeenCalled();
  });
});
