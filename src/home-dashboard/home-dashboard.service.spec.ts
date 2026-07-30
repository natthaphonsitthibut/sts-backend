import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HomeDashboardRepository } from './home-dashboard.repository';
import { HomeDashboardService } from './home-dashboard.service';
import type { HomeDashboardActor } from './home-dashboard.types';

const baseActor: HomeDashboardActor = {
  id: 1,
  username: 'admin',
  roles: ['ADMIN'],
  permissions: ['home', 'dashboard', 'attendance-dashboard', 'review-cases', 'students'],
  data_scope: { school_ids: [10010002] },
};

function createRepositoryMock(): jest.Mocked<
  Pick<
    HomeDashboardRepository,
    | 'validateAreaFilters'
    | 'countStudents'
    | 'countActiveCases'
    | 'countHighRiskStudents'
    | 'getCasePipeline'
    | 'getAttentionItems'
    | 'getAttendanceTrend'
    | 'getRiskDistribution'
    | 'getRiskThresholds'
    | 'getCurrentTermStart'
    | 'getCaseMovement'
    | 'getFilterOptions'
  >
> {
  return {
    validateAreaFilters: jest.fn().mockResolvedValue(true),
    countStudents: jest.fn().mockResolvedValue(120),
    countActiveCases: jest.fn().mockResolvedValue(8),
    countHighRiskStudents: jest.fn().mockResolvedValue(5),
    getCasePipeline: jest.fn().mockResolvedValue({
      OPEN: 1,
      IN_PROGRESS: 2,
      PENDING_REVIEW: 3,
      RESOLVED: 4,
    }),
    getAttentionItems: jest.fn().mockResolvedValue([
      {
        id: 'risk-high',
        kind: 'RISK_HIGH',
        label: 'นักเรียนที่ต้องเฝ้าระวังสูง',
        reason: 'reason',
        count: 5,
        age_label: null,
        target_path: '/student-risk-report',
        target_query: { riskTier: 'HIGH' },
        priority: 20,
      },
    ]),
    getAttendanceTrend: jest.fn().mockResolvedValue([]),
    getRiskDistribution: jest.fn().mockResolvedValue({
      HIGH: 2,
      MEDIUM: 3,
      LOW: 0,
      WATCH: 1,
      NORMAL: 114,
    }),
    getRiskThresholds: jest.fn().mockResolvedValue({
      lowConsecutiveAbsentDays: 3,
      mediumConsecutiveAbsentDays: 5,
      highConsecutiveAbsentDays: 7,
    }),
    getCurrentTermStart: jest.fn().mockResolvedValue('2026-05-16'),
    getCaseMovement: jest.fn().mockResolvedValue([]),
    getFilterOptions: jest.fn().mockResolvedValue({
      provinces: [],
      districts: [],
      subDistricts: [],
      schools: [],
      grades: [],
      rooms: [],
    }),
  };
}

describe('HomeDashboardService', () => {
  it('returns role-aware sections and bounded attention items', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const result = await service.getSummary(baseActor, { schoolId: 10010002 });

    expect(result.data.availableSections).toEqual(
      expect.arrayContaining([
        'attention',
        'attendanceTrend',
        'riskDistribution',
        'casePipeline',
        'caseMovement',
      ]),
    );
    expect(result.data.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'totalStudents',
          label: 'ทั้งหมด',
          tone: 'default',
          value: 120,
        }),
        expect.objectContaining({
          key: 'watchStudents',
          label: 'เสี่ยงสูง',
          tone: 'danger',
          value: 5,
        }),
        expect.objectContaining({
          key: 'activeCases',
          label: 'กำลังติดตาม',
          tone: 'warning',
          value: 8,
        }),
        expect.objectContaining({
          key: 'pendingReview',
          label: 'รอตรวจผล',
          tone: 'info',
          value: 3,
        }),
      ]),
    );
    expect(result.data.attentionItems).toHaveLength(1);
    const targetQuery = result.data.attentionItems[0]?.targetQuery;
    expect(result.data.attentionItems[0]).toEqual(
      expect.objectContaining({
        targetPath: '/student-risk-report',
      }),
    );
    expect(targetQuery).toMatchObject({ schoolId: 10010002, riskTier: 'HIGH' });
  });

  it('hides dashboard/case sections when actor only has attendance permissions', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);
    const actor: HomeDashboardActor = {
      ...baseActor,
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
    };

    const result = await service.getTrends(actor, {});

    expect(result.data.availableSections).toEqual(['attention', 'recentWork', 'attendanceTrend']);
    expect(result.data.riskDistribution).toBeNull();
    expect(result.data.casePipeline).toBeNull();
    expect(repository.getRiskDistribution).not.toHaveBeenCalled();
    expect(repository.getCasePipeline).not.toHaveBeenCalled();
  });

  it('rejects invalid cascade filters before querying aggregates', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    await expect(service.getSummary(baseActor, { district: 'เมืองชลบุรี' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.countStudents).not.toHaveBeenCalled();
  });

  it('rejects out-of-scope filters', async () => {
    const repository = createRepositoryMock();
    repository.validateAreaFilters.mockResolvedValue(false);
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    await expect(service.getSummary(baseActor, { schoolId: 99999999 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.countStudents).not.toHaveBeenCalled();
  });

  it('uses the active school term instead of a fixed-day approximation', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    await service.getTrends(baseActor, { period: 'CURRENT_TERM', schoolId: 10010002 });

    expect(repository.getCurrentTermStart).toHaveBeenCalledWith(
      baseActor,
      expect.objectContaining({ period: 'CURRENT_TERM', schoolId: 10010002 }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(repository.getAttendanceTrend).toHaveBeenCalledWith(
      baseActor,
      expect.any(Object),
      '2026-05-16',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });
});
