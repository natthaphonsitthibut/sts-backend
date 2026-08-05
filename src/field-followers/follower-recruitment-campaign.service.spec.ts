import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskPolicyService } from '../task/task-policy.service';
import type { TaskService } from '../task/task.service';
import { FollowerRecruitmentCampaignRepository } from './follower-recruitment-campaign.repository';
import { FollowerRecruitmentCampaignService } from './follower-recruitment-campaign.service';
import type {
  FollowerAssignmentCandidateRow,
  FollowerCampaignTargetRow,
  FollowerRecruitmentCampaignRow,
} from './follower-recruitment-campaign.types';

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
      | 'addTargets'
      | 'listTargets'
      | 'findTargetById'
      | 'findActiveFollowerForCampaign'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let taskService: jest.Mocked<Pick<TaskService, 'findCaseForActor'>>;
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
      status: 'ACTIVE',
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

  function targetRow(
    overrides: Partial<FollowerCampaignTargetRow> = {},
  ): FollowerCampaignTargetRow {
    return {
      id: '10',
      campaign_id: '1',
      case_id: 99,
      status: 'OPEN',
      assigned_follower_id: null,
      assigned_task_link_id: null,
      assigned_at: null,
      assigned_by: null,
      created_at: new Date('2026-07-11T00:00:00Z'),
      updated_at: new Date('2026-07-11T00:00:00Z'),
      case_student_name: 'เด็กทดสอบ',
      case_student_id: 'student-1',
      case_student_school: 'โรงเรียนทดสอบ',
      case_student_address: 'บ้านทดสอบ',
      case_reason_flagged: 'ต้องเยี่ยมบ้าน',
      assigned_follower_name: null,
      assigned_follower_email: null,
      assigned_follower_phone: null,
      ...overrides,
    };
  }

  function followerCandidate(
    overrides: Partial<FollowerAssignmentCandidateRow> = {},
  ): FollowerAssignmentCandidateRow {
    return {
      id: '7',
      first_name: 'อสม',
      last_name: 'ทดสอบ',
      phone: '0812345678',
      email: 'follower@example.test',
      status: 'ACTIVE',
      campaign_id: '1',
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
      addTargets: jest.fn().mockResolvedValue([targetRow()]),
      listTargets: jest.fn().mockResolvedValue([targetRow()]),
      findTargetById: jest.fn().mockResolvedValue(targetRow()),
      findActiveFollowerForCampaign: jest.fn().mockResolvedValue(followerCandidate()),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    taskService = {
      findCaseForActor: jest.fn().mockResolvedValue({ id: 99, school_id: 10010002 }),
    };

    service = new FollowerRecruitmentCampaignService(
      repository as unknown as FollowerRecruitmentCampaignRepository,
      taskPolicyService,
      taskService as unknown as TaskService,
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

    it('derives status live so a past window reads EXPIRED, not a stale ACTIVE', async () => {
      repository.listAll.mockResolvedValue([
        campaignRow({
          is_active: true,
          status: 'ACTIVE',
          closes_at: new Date('2000-01-01T00:00:00Z'),
        }),
      ]);

      const result = await service.list(districtActor);

      expect(result.data[0].status).toBe('EXPIRED');
      expect(result.data[0].is_open).toBe(false);
    });

    it('reports a not-yet-opened campaign as SCHEDULED, distinct from LOCKED/EXPIRED', async () => {
      repository.listAll.mockResolvedValue([
        campaignRow({ id: 'future', is_active: true, opens_at: new Date('2999-01-01T00:00:00Z') }),
        campaignRow({ id: 'off', is_active: false }),
      ]);

      const result = await service.list(districtActor);

      const byId = Object.fromEntries(result.data.map((row) => [row.id, row.status]));
      expect(byId.future).toBe('SCHEDULED');
      expect(byId.off).toBe('LOCKED');
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

  describe('targets', () => {
    it('adds campaign targets only after case scope checks pass', async () => {
      const result = await service.addTargets('1', { case_ids: [99, 99] }, districtActor, {
        ip: null,
      });

      expect(taskService.findCaseForActor).toHaveBeenCalledWith(99, districtActor);
      expect(repository.addTargets).toHaveBeenCalledWith('1', [99], districtActor.id);
      expect(result.data).toHaveLength(1);
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'FOLLOWER_CAMPAIGN_TARGETS_ADD' }),
      );
    });

    it('blocks adding a target outside case scope', async () => {
      taskService.findCaseForActor.mockResolvedValue(null);

      await expect(
        service.addTargets('1', { case_ids: [99] }, districtActor, { ip: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.addTargets).not.toHaveBeenCalled();
    });

    it('returns assignment prefill for an active follower with email', async () => {
      const result = await service.prepareTargetAssignment('10', { follower_id: 7 }, districtActor);

      expect(repository.findActiveFollowerForCampaign).toHaveBeenCalledWith(7, '1');
      expect(result.data.prefill).toEqual(
        expect.objectContaining({
          task_type: 'VISIT',
          existing_case_id: 99,
          assigned_to_email: 'follower@example.test',
          source_field_follower_id: '7',
          campaign_target_id: '10',
        }),
      );
    });

    it('blocks assignment preview when the target is no longer open', async () => {
      repository.findTargetById.mockResolvedValue(targetRow({ status: 'ASSIGNED' }));

      await expect(
        service.prepareTargetAssignment('10', { follower_id: 7 }, districtActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks assignment preview when follower email is missing', async () => {
      repository.findActiveFollowerForCampaign.mockResolvedValue(
        followerCandidate({ email: null }),
      );

      await expect(
        service.prepareTargetAssignment('10', { follower_id: 7 }, districtActor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
