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
    | 'getHighRiskAreaRanking'
    | 'getCasePipeline'
    | 'getAttentionItems'
    | 'getAttendanceTrend'
    | 'getRiskDistribution'
    | 'getRiskThresholds'
    | 'getCurrentTermStart'
    | 'getCaseMovement'
    | 'getFilterOptions'
    | 'getSchoolName'
  >
> {
  return {
    validateAreaFilters: jest.fn().mockResolvedValue(true),
    countStudents: jest.fn().mockResolvedValue(120),
    countActiveCases: jest.fn().mockResolvedValue(8),
    countHighRiskStudents: jest.fn().mockResolvedValue(5),
    getHighRiskAreaRanking: jest
      .fn()
      .mockResolvedValue([{ key: 'เชียงใหม่', label: 'เชียงใหม่', count: 5 }]),
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
    getSchoolName: jest.fn().mockResolvedValue(null),
  };
}

describe('HomeDashboardService', () => {
  it('returns role-aware sections and bounded attention items', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const result = await service.getSummary(baseActor, {});

    expect(result.data.availableSections).toEqual(
      expect.arrayContaining([
        'attendanceTrend',
        'riskDistribution',
        'riskAreaRanking',
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
          label: 'เสี่ยง',
          tone: 'danger',
          value: 5,
        }),
        expect.objectContaining({
          key: 'activeCases',
          label: 'รอติดตาม',
          tone: 'warning',
          value: 8,
        }),
        expect.objectContaining({
          key: 'pendingReview',
          label: 'รอพิจารณา',
          tone: 'info',
          value: 3,
        }),
      ]),
    );
    expect(result.data.attentionItems).toEqual([]);
    expect(result.data.riskAreaRanking).toEqual({
      dimension: 'PROVINCE',
      dimensionLabel: 'จังหวัด',
      items: [
        {
          key: 'เชียงใหม่',
          label: 'เชียงใหม่',
          count: 5,
          targetFilter: { province: 'เชียงใหม่' },
        },
      ],
    });
    expect(result.data.casePipeline).toEqual({
      OPEN: 1,
      IN_PROGRESS: 2,
      PENDING_REVIEW: 3,
      RESOLVED: 4,
    });
  });

  it('uses the school name instead of its id in the scope label', async () => {
    const repository = createRepositoryMock();
    repository.getSchoolName.mockResolvedValue('โรงเรียนตัวอย่าง');
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const result = await service.getSummary(baseActor, { schoolId: 10010004 });

    expect(result.data.scopeLabel).toBe('โรงเรียนตัวอย่าง');
    expect(repository.getSchoolName).toHaveBeenCalledWith(10010004);
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

    expect(result.data.availableSections).toEqual(['attendanceTrend']);
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

  it.each([
    [{}, 'PROVINCE'],
    [{ province: 'เชียงใหม่' }, 'DISTRICT'],
    [{ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่' }, 'SUB_DISTRICT'],
    [
      {
        province: 'เชียงใหม่',
        district: 'เมืองเชียงใหม่',
        subDistrict: 'สุเทพ',
      },
      'SCHOOL',
    ],
    [{ schoolId: 10010002 }, 'SCHOOL'],
  ] as const)('groups high-risk students by the next area level', async (filters, dimension) => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    await service.getSummary(baseActor, filters);

    expect(repository.getHighRiskAreaRanking).toHaveBeenCalledWith(
      baseActor,
      expect.objectContaining(filters),
      dimension,
    );
  });
});
