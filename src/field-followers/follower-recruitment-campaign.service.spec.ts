import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskPolicyService } from '../task/task-policy.service';
import { FollowerRecruitmentCampaignRepository } from './follower-recruitment-campaign.repository';
import { FollowerRecruitmentCampaignService } from './follower-recruitment-campaign.service';
import type { FollowerRecruitmentCampaignRow } from './follower-recruitment-campaign.types';

describe('FollowerRecruitmentCampaignService', () => {
  let service: FollowerRecruitmentCampaignService;
  let repository: jest.Mocked<
    Pick<
      FollowerRecruitmentCampaignRepository,
      | 'create'
      | 'listAll'
      | 'findById'
      | 'findByPublicCode'
      | 'update'
      | 'softDelete'
      | 'incrementViewCount'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  // Real TaskPolicyService — its scope-subset logic is pure (no repository
  // access for the methods used here) and is the same logic this feature
  // deliberately reuses instead of duplicating (see task-ui-data-feedback-round.md §E).
  const taskPolicyService = new TaskPolicyService({} as never);

  const districtActor = {
    id: 1,
    username: 'district_admin',
    roles: ['DISTRICT_ADMIN'],
    permissions: ['field-monitor'],
    data_scope: { districts: ['เมืองเชียงใหม่'] },
  };
  const otherDistrictActor = {
    id: 2,
    username: 'other_admin',
    roles: ['DISTRICT_ADMIN'],
    permissions: ['field-monitor'],
    data_scope: { districts: ['สันทราย'] },
  };

  function campaignRow(
    overrides: Partial<FollowerRecruitmentCampaignRow> = {},
  ): FollowerRecruitmentCampaignRow {
    return {
      id: '1',
      name: 'รับสมัคร อสม. รอบ 1',
      description: null,
      public_code: 'abc123def456',
      data_scope: { districts: ['เมืองเชียงใหม่'] },
      is_active: true,
      opens_at: null,
      closes_at: null,
      view_count: 0,
      created_at: new Date('2026-07-09T00:00:00Z'),
      created_by: 1,
      updated_at: new Date('2026-07-09T00:00:00Z'),
      updated_by: 1,
      deleted_at: null,
      deleted_by: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      create: jest.fn().mockResolvedValue(campaignRow()),
      listAll: jest.fn().mockResolvedValue([campaignRow()]),
      findById: jest.fn().mockResolvedValue(campaignRow()),
      findByPublicCode: jest.fn().mockResolvedValue(campaignRow()),
      update: jest.fn().mockResolvedValue(campaignRow()),
      softDelete: jest.fn().mockResolvedValue(campaignRow()),
      incrementViewCount: jest.fn().mockResolvedValue(undefined),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    service = new FollowerRecruitmentCampaignService(
      repository as unknown as FollowerRecruitmentCampaignRepository,
      taskPolicyService,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('create', () => {
    it('defaults data_scope to the actor own scope when omitted', async () => {
      await service.create({ name: 'รับสมัคร อสม. รอบ 1' }, districtActor, { ip: null });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ dataScope: { districts: ['เมืองเชียงใหม่'] } }),
      );
    });

    it('rejects a requested scope wider than the actor own scope', async () => {
      await expect(
        service.create(
          { name: 'รับสมัครทั้งจังหวัด', data_scope: { provinces: ['เชียงใหม่'] } },
          districtActor,
          { ip: null },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects closes_at at or before opens_at', async () => {
      await expect(
        service.create(
          {
            name: 'รับสมัคร อสม. รอบ 1',
            opens_at: '2026-08-01T00:00:00Z',
            closes_at: '2026-07-01T00:00:00Z',
          },
          districtActor,
          { ip: null },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a blank name after trimming', async () => {
      await expect(
        service.create({ name: '   ' }, districtActor, { ip: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('retries public_code generation on a unique-constraint collision', async () => {
      const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
      repository.create.mockRejectedValueOnce(conflict).mockResolvedValueOnce(campaignRow());

      const result = await service.create({ name: 'รับสมัคร อสม. รอบ 1' }, districtActor, {
        ip: null,
      });

      expect(repository.create).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('audits creation with FOLLOWER_CAMPAIGN_CREATE', async () => {
      await service.create({ name: 'รับสมัคร อสม. รอบ 1' }, districtActor, { ip: '127.0.0.1' });

      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FOLLOWER_CAMPAIGN_CREATE' }),
      );
    });
  });

  describe('list', () => {
    it('filters out campaigns outside the actor scope', async () => {
      repository.listAll.mockResolvedValue([
        campaignRow({ id: '1', data_scope: { districts: ['เมืองเชียงใหม่'] } }),
        campaignRow({ id: '2', data_scope: { districts: ['สันทราย'] } }),
      ]);

      const result = await service.list(districtActor);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('1');
    });
  });

  describe('update', () => {
    it('throws not-found (not forbidden) when the campaign is outside the actor scope', async () => {
      repository.findById.mockResolvedValue(
        campaignRow({ data_scope: { districts: ['สันทราย'] } }),
      );

      await expect(
        service.update('1', { is_active: false }, districtActor, { ip: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects widening scope beyond the actor own scope on update', async () => {
      await expect(
        service.update('1', { data_scope: { provinces: ['เชียงใหม่'] } }, districtActor, {
          ip: null,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('allows an in-scope actor to toggle is_active', async () => {
      const result = await service.update('1', { is_active: false }, districtActor, {
        ip: null,
      });

      expect(repository.update).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ isActive: false }),
      );
      expect(result.success).toBe(true);
    });

    it('a different-district actor cannot even reach the scope-widening check (404 first)', async () => {
      // campaignRow() defaults to districts: ['เมืองเชียงใหม่'] — outside otherDistrictActor's
      // own scope (districts: ['สันทราย']), so findAuthorized must 404 before any update logic runs.
      await expect(
        service.update('1', {}, otherDistrictActor, { ip: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getPublicCampaignInfo', () => {
    it('reports open for an active campaign with no window bounds', async () => {
      const result = await service.getPublicCampaignInfo('abc123def456');

      expect(result).toEqual({ name: 'รับสมัคร อสม. รอบ 1', is_open: true });
      expect(repository.incrementViewCount).toHaveBeenCalledWith('1');
    });

    it('reports closed for an inactive campaign', async () => {
      repository.findByPublicCode.mockResolvedValue(campaignRow({ is_active: false }));

      const result = await service.getPublicCampaignInfo('abc123def456');

      expect(result.is_open).toBe(false);
    });

    it('reports closed before opens_at and at/after closes_at', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      repository.findByPublicCode.mockResolvedValue(campaignRow({ opens_at: future }));

      expect((await service.getPublicCampaignInfo('abc123def456')).is_open).toBe(false);

      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      repository.findByPublicCode.mockResolvedValue(campaignRow({ closes_at: past }));

      expect((await service.getPublicCampaignInfo('abc123def456')).is_open).toBe(false);
    });

    it('throws not-found for an unknown code', async () => {
      repository.findByPublicCode.mockResolvedValue(null);

      await expect(service.getPublicCampaignInfo('does-not-exist')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resolveOpenCampaignByCode', () => {
    it('returns the row for an open campaign', async () => {
      const row = await service.resolveOpenCampaignByCode('abc123def456');
      expect(row.id).toBe('1');
    });

    it('throws BadRequestException for a closed campaign', async () => {
      repository.findByPublicCode.mockResolvedValue(campaignRow({ is_active: false }));

      await expect(service.resolveOpenCampaignByCode('abc123def456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an unknown code', async () => {
      repository.findByPublicCode.mockResolvedValue(null);

      await expect(service.resolveOpenCampaignByCode('does-not-exist')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
