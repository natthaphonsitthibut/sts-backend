import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { TaskStatsService } from './task-stats.service';

describe('TaskStatsService', () => {
  it('returns the scoped at-risk student count in case stats', async () => {
    const actor = {
      id: 7,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['view-dashboard'],
      data_scope: { school_ids: [101] },
    };
    const taskRepository = {
      countCases: jest.fn().mockResolvedValue(0),
      countAtRiskStudents: jest.fn().mockResolvedValue(9),
      countCasesCreatedOn: jest.fn().mockResolvedValue(0),
      countActiveTaskLinks: jest.fn().mockResolvedValue(0),
      countCaseStatuses: jest.fn().mockResolvedValue({ OPEN: 2 }),
    };
    const taskPolicyService = {
      ensureActor: jest.fn().mockReturnValue(actor),
    };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(service.getStats(actor)).resolves.toEqual(
      expect.objectContaining({ atRiskStudents: 9, statusCounts: { OPEN: 2 } }),
    );
    expect(taskRepository.countAtRiskStudents).toHaveBeenCalledWith(actor);
  });

  it('returns the scoped at-risk student count in overview stats', async () => {
    const actor = {
      id: 7,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['view-dashboard'],
      data_scope: { school_ids: [101] },
    };
    const taskRepository = {
      countStudents: jest.fn().mockResolvedValue(120),
      countActiveCases: jest.fn().mockResolvedValue(4),
      countAtRiskStudents: jest.fn().mockResolvedValue(9),
      countCases: jest
        .fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(12),
    };
    const taskPolicyService = {
      ensureActor: jest.fn().mockReturnValue(actor),
    };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(service.getOverviewStats(actor)).resolves.toEqual({
      success: true,
      data: {
        totalStudents: 120,
        activeCases: 4,
        atRiskStudents: 9,
        helpStats: {
          waiting: 3,
          inProgress: 5,
          resolved: 12,
        },
      },
    });
    expect(taskRepository.countActiveCases).toHaveBeenCalledWith(actor);
    expect(taskRepository.countAtRiskStudents).toHaveBeenCalledWith(actor);
  });

  it('returns a scoped risk dashboard with configured thresholds', async () => {
    const actor = {
      id: 7,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['dashboard'],
      data_scope: { school_ids: [101] },
    };
    const taskRepository = {
      getSystemSettingValue: jest
        .fn()
        .mockResolvedValueOnce('4')
        .mockResolvedValueOnce('6')
        .mockResolvedValueOnce('9'),
      listRiskDashboardStudents: jest.fn().mockResolvedValue({
        rows: [
          {
            student_uuid: 'student-1',
            student_name: 'เด็ก ทดสอบ',
            school_id: 101,
            school_name: 'โรงเรียนทดสอบ',
            grade: 'ม.1',
            room: '1',
            consecutive_absent_days: 4,
            absent_days: 5,
            late_count: 2,
            school_day_count: 20,
            weighted_absence_days: '5.50',
            weighted_attendance_percent: '72.5',
            risk_tier: 'HIGH',
            risk_score: '1.0000',
            open_case_count: 1,
            latest_case_at: '2026-07-06T00:00:00.000Z',
          },
        ],
        totalCount: 1,
        summary: { HIGH: 1, MEDIUM: 0, LOW: 0, WATCH: 0, NORMAL: 0 },
      }),
    };
    const taskPolicyService = {
      ensureActor: jest.fn().mockReturnValue(actor),
    };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(
      service.getRiskDashboard(actor, { page: 1, limit: 20, riskTier: 'HIGH' }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          studentId: 'student-1',
          riskTier: 'HIGH',
          weightedAttendancePercent: 72.5,
        },
      ],
      meta: {
        page: 1,
        limit: 20,
        totalCount: 1,
        summary: { HIGH: 1, MEDIUM: 0, LOW: 0, WATCH: 0, NORMAL: 0 },
        thresholds: {
          lowConsecutiveAbsentDays: 4,
          mediumConsecutiveAbsentDays: 6,
          highConsecutiveAbsentDays: 9,
        },
      },
    });
    expect(taskRepository.listRiskDashboardStudents).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ riskTier: 'HIGH', sortBy: 'risk', sortDirection: 'desc' }),
      expect.objectContaining({
        lowConsecutiveAbsentDays: 4,
        mediumConsecutiveAbsentDays: 6,
        highConsecutiveAbsentDays: 9,
        watchProgressRatio: 0.7,
      }),
    );
  });
});
