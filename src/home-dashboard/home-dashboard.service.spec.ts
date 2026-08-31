import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HomeDashboardRepository } from './home-dashboard.repository';
import { HomeDashboardService } from './home-dashboard.service';
import type { HomeDashboardActor } from './home-dashboard.types';

const baseActor: HomeDashboardActor = {
  id: 1,
  username: 'admin',
  roles: ['ADMIN'],
  permissions: ['home', 'dashboard', 'students'],
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
    | 'getMonthlySuccessRates'
    | 'getCasePipeline'
    | 'getAttentionItems'
    | 'getAttendanceTrend'
    | 'getRiskDistribution'
    | 'getRiskThresholds'
    | 'getCurrentTermStart'
    | 'getCaseMovement'
    | 'getGradeRiskDistribution'
    | 'getFollowUpCoverage'
    | 'getFollowUpProblemCategories'
    | 'getObservationProblemCategories'
    | 'getFollowUpAbsenceReasonCategories'
    | 'getTeacherConcernLevels'
    | 'getProblemOutcomeMatrix'
    | 'getProblemAreaMatrix'
    | 'getNonFollowUpReasons'
    | 'getOtherProblemDetails'
    | 'getReferralFunnel'
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
    getGradeRiskDistribution: jest.fn().mockResolvedValue([]),
    getFollowUpCoverage: jest.fn().mockResolvedValue({
      atRiskStudents: 5,
      followedUpStudents: 2,
      pendingStudents: 3,
      recordedStudents: 4,
    }),
    getFollowUpProblemCategories: jest
      .fn()
      .mockResolvedValue([{ key: 'FINANCIAL', label: 'ปัญหาด้านการเงิน', count: 4 }]),
    getObservationProblemCategories: jest
      .fn()
      .mockResolvedValue([{ key: 'FINANCIAL', label: 'ปัญหาด้านการเงิน', count: 1 }]),
    getFollowUpAbsenceReasonCategories: jest.fn().mockResolvedValue([]),
    getTeacherConcernLevels: jest.fn().mockResolvedValue([]),
    getProblemOutcomeMatrix: jest.fn().mockResolvedValue([]),
    getProblemAreaMatrix: jest.fn().mockResolvedValue([]),
    getNonFollowUpReasons: jest.fn().mockResolvedValue([]),
    getOtherProblemDetails: jest.fn().mockResolvedValue([]),
    getReferralFunnel: jest.fn().mockResolvedValue({ referred: 0, accepted: 0, pending: 0 }),
    getMonthlySuccessRates: jest.fn().mockResolvedValue([]),
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
    // The case tiles are derived from the pipeline the repository returned
    // (OPEN 1 + IN_PROGRESS 2 + PENDING_REVIEW 3 are ongoing, RESOLVED 4 is done),
    // so the numbers below are that arithmetic rather than copies of a fixture.
    expect(result.data.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'totalStudents',
          label: 'นักเรียนทั้งหมด',
          tone: 'default',
          value: 120,
        }),
        expect.objectContaining({
          key: 'watchStudents',
          label: 'นักเรียนกลุ่มเสี่ยง',
          tone: 'danger',
          value: 5,
        }),
        expect.objectContaining({ key: 'totalCases', value: 1 + 2 + 3 + 4 }),
        expect.objectContaining({ key: 'inProgressCases', tone: 'warning', value: 1 + 2 + 3 }),
        expect.objectContaining({ key: 'resolvedCases', tone: 'success', value: 4 }),
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

  it('shows every section to an actor without dashboard permissions', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);
    const actor: HomeDashboardActor = {
      ...baseActor,
      roles: ['TEACHER'],
      permissions: ['home', 'attendance'],
    };

    const result = await service.getTrends(actor, {});

    // Opening /student-risk-report or /cases still needs the permission; what
    // the overview says about the scope this actor already sees does not.
    expect(result.data.availableSections).toEqual([
      'attendanceTrend',
      'riskDistribution',
      'casePipeline',
      'caseMovement',
    ]);
    expect(repository.getRiskDistribution).toHaveBeenCalled();
    expect(repository.getCasePipeline).toHaveBeenCalled();
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

  it('points case tiles at a route the menu can resolve', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const result = await service.getSummary(baseActor, {});
    const caseMetrics = result.data.metrics.filter((metric) =>
      ['totalCases', 'inProgressCases', 'resolvedCases'].includes(metric.key),
    );

    // `/cases` is only a legacy redirect and carries no menu entry, and the
    // frontend resolves permission by exact menu route, so every case tile
    // rendered dead — for admins too.
    expect(caseMetrics).toHaveLength(3);
    for (const metric of caseMetrics) {
      expect(metric.targetPath).toBe('/student-risk-report');
      expect(metric.targetQuery).not.toHaveProperty('status');
    }
    expect(
      caseMetrics.find((metric) => metric.key === 'inProgressCases')?.targetQuery,
    ).toMatchObject({ caseStatus: 'OPEN,IN_PROGRESS,PENDING_REVIEW' });
    expect(caseMetrics.find((metric) => metric.key === 'resolvedCases')?.targetQuery).toMatchObject(
      { caseStatus: 'RESOLVED' },
    );
  });

  it('keeps follow-up and observation counts apart in the problem mix', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const result = await service.getFollowUpInsights(baseActor, {});

    expect(result.data.problemCategories).toEqual([
      {
        key: 'FINANCIAL',
        label: 'ปัญหาด้านการเงิน',
        followUp: 4,
        observation: 1,
        total: 5,
      },
    ]);
    // A closed case drops the student's tier back, so the recorded population the
    // charts describe is larger than the "still at risk" snapshot.
    expect(result.data.coverage).toEqual({
      atRiskStudents: 5,
      followedUpStudents: 2,
      pendingStudents: 3,
      recordedStudents: 4,
    });
  });

  it('drops the area cross-tab once the scope is a single school', async () => {
    const repository = createRepositoryMock();
    const service = new HomeDashboardService(repository as unknown as HomeDashboardRepository);

    const national = await service.getFollowUpInsights(baseActor, {});
    const school = await service.getFollowUpInsights(baseActor, { schoolId: 10010002 });

    expect(national.data.problemByArea?.dimension).toBe('PROVINCE');
    expect(school.data.problemByArea).toBeNull();
    expect(repository.getProblemAreaMatrix).toHaveBeenCalledTimes(1);
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
    // Inside one school geography runs out, so the ranking drills into ชั้น then ห้อง.
    [{ schoolId: 10010002 }, 'GRADE'],
    [{ schoolId: 10010002, grade: 'ป.1' }, 'ROOM'],
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
