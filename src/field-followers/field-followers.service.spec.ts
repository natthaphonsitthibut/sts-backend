import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { FieldFollowersRepository } from './field-followers.repository';
import { FieldFollowersService } from './field-followers.service';
import type { FieldFollowerRow } from './field-followers.types';

describe('FieldFollowersService', () => {
  let service: FieldFollowersService;
  let repository: jest.Mocked<
    Pick<
      FieldFollowersRepository,
      'createApplication' | 'listFollowers' | 'findByIdInScope' | 'updateStatus'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  const actor = {
    id: 1,
    username: 'director1',
    roles: ['DIRECTOR'],
    permissions: ['field-monitor'],
    data_scope: { school_ids: [10010002] },
  };

  function followerRow(overrides: Partial<FieldFollowerRow> = {}): FieldFollowerRow {
    return {
      id: '1',
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      phone: '0812345678',
      sub_district: null,
      district: null,
      province: 'เชียงใหม่',
      status: 'APPLIED',
      trust_level: 'STANDARD',
      applied_via: 'PUBLIC_FORM',
      reviewed_by_user_id: null,
      reviewed_at: null,
      created_at: new Date('2026-07-06T00:00:00Z'),
      updated_at: new Date('2026-07-06T00:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      createApplication: jest.fn().mockResolvedValue(followerRow()),
      listFollowers: jest.fn().mockResolvedValue({ rows: [followerRow()], totalCount: 1 }),
      findByIdInScope: jest.fn().mockResolvedValue(followerRow()),
      updateStatus: jest.fn().mockResolvedValue(followerRow({ status: 'ACTIVE' })),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new FieldFollowersService(
      repository as unknown as FieldFollowersRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('createApplication', () => {
    it('creates the application and audits without PII beyond area', async () => {
      const result = await service.createApplication(
        { first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678', province: 'เชียงใหม่' },
        { ip: '127.0.0.1' },
      );

      expect(result).toEqual({ success: true });
      expect(repository.createApplication).toHaveBeenCalledWith({
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        subDistrict: null,
        district: null,
        province: 'เชียงใหม่',
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FIELD_FOLLOWER_APPLY' }),
      );
    });

    it('silently drops the submission when the honeypot field is filled', async () => {
      const result = await service.createApplication(
        {
          first_name: 'bot',
          last_name: 'bot',
          phone: '0800000000',
          website: 'https://spam.example',
        },
        { ip: '127.0.0.1' },
      );

      expect(result).toEqual({ success: true });
      expect(repository.createApplication).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('rejects an application with a blank name after trimming', async () => {
      await expect(
        service.createApplication(
          { first_name: '   ', last_name: 'ใจดี', phone: '0812345678' },
          { ip: null },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createApplication).not.toHaveBeenCalled();
    });
  });

  describe('reviewFollower', () => {
    it('approves an APPLIED follower and audits the transition', async () => {
      const result = await service.reviewFollower('1', 'APPROVE', actor, { ip: null });

      expect(repository.updateStatus).toHaveBeenCalledWith('1', 'ACTIVE', actor.id);
      expect(result.data.status).toBe('ACTIVE');
      const auditCall = auditLog.record.mock.calls[0]?.[0];
      expect(auditCall?.action).toBe('FIELD_FOLLOWER_REVIEW');
      expect(auditCall?.metadata).toEqual(
        expect.objectContaining({ reviewAction: 'APPROVE', toStatus: 'ACTIVE' }),
      );
    });

    it('rejects an invalid transition (approve an already-active follower)', async () => {
      repository.findByIdInScope.mockResolvedValue(followerRow({ status: 'ACTIVE' }));

      await expect(
        service.reviewFollower('1', 'APPROVE', actor, { ip: null }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it('throws not-found when the follower is outside the actor scope', async () => {
      repository.findByIdInScope.mockResolvedValue(null);

      await expect(
        service.reviewFollower('99', 'APPROVE', actor, { ip: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
