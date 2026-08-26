import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { TaskStatsService } from './task-stats.service';
import { ForbiddenException } from '@nestjs/common';

describe('TaskStatsService', () => {
  it('returns aggregate-only follow-up outcomes and referral backlog to an EXECUTIVE', async () => {
    const actor = {
      id: 70,
      username: 'executive',
      roles: ['EXECUTIVE'],
      permissions: ['dashboard'],
      data_scope: { provinces: ['เชียงใหม่'] },
    };
    const taskRepository = {
      getFollowUpOutcomeAggregate: jest.fn().mockResolvedValue([
        { task_type: 'VISIT', task_execution_outcome_code: 'SUCCEEDED', activity_count: 8 },
        { task_type: 'VISIT', task_execution_outcome_code: 'NOT_SUCCEEDED', activity_count: 2 },
        { task_type: 'ASSIST', task_execution_outcome_code: 'SUCCEEDED', activity_count: 3 },
      ]),
      getAssistanceMeasureAggregate: jest.fn().mockResolvedValue([]),
      getReferralAggregate: jest.fn().mockResolvedValue([
        {
          status_code: 'REFERRED',
          agency_name: 'หน่วยงาน ก',
          referral_count: 4,
          overdue_count: 1,
        },
      ]),
      countRepeatedUnsuccessfulCases: jest.fn().mockResolvedValue(2),
    };
    const taskPolicyService = { ensureActor: jest.fn().mockReturnValue(actor) };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    const result = await service.getFollowUpSummary(actor);
    expect(result.data.outcomes).toEqual({
      visit: { succeeded: 8, notSucceeded: 2, total: 10, successRate: 80 },
      assist: { succeeded: 3, notSucceeded: 0, total: 3, successRate: 100 },
    });
    expect(result.data.referrals).toMatchObject({
      total: 4,
      overdue: 1,
      byStatus: { REFERRED: 4 },
    });
    expect(result.data.repeatedUnsuccessfulCaseCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain('studentName');
  });

  it('denies referral PII drill-down to an EXECUTIVE', async () => {
    const actor = {
      id: 70,
      username: 'executive',
      roles: ['EXECUTIVE'],
      permissions: ['dashboard'],
      data_scope: { global: true },
    };
    const taskRepository = { listReferralDrilldown: jest.fn() };
    const taskPolicyService = { ensureActor: jest.fn().mockReturnValue(actor) };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(service.getReferralDrilldown(actor, 1, 20)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(taskRepository.listReferralDrilldown).not.toHaveBeenCalled();
  });

  it('denies raw case lists to an EXECUTIVE even when review-cases is re-granted', async () => {
    const actor = {
      id: 70,
      username: 'executive.regranted',
      roles: ['EXECUTIVE'],
      permissions: ['dashboard'],
      data_scope: { provinces: ['เชียงใหม่'] },
    };
    const taskRepository = { listCasesWithActiveLinks: jest.fn() };
    const taskPolicyService = { ensureActor: jest.fn().mockReturnValue(actor) };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(service.getCases(actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskRepository.listCasesWithActiveLinks).not.toHaveBeenCalled();
  });

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
        caseTrackingStats: {
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
      getSystemSettingValue: jest.fn().mockResolvedValue('4'),
      listRiskDashboardStudents: jest.fn().mockResolvedValue({
        rows: [
          {
            student_uuid: 'student-1',
            student_name: 'เด็ก ทดสอบ',
            photo_storage_key: 'student-photos/person/profile.webp',
            photo_updated_at: '2026-08-10T06:30:00.000Z',
            school_id: 101,
            school_name: 'โรงเรียนทดสอบ',
            grade: 'ม.1',
            room: '1',
            consecutive_absent_days: 4,
            absent_days_since_case_reset: 5,
            term_absent_days: 8,
            absence_reset_after_date: '2026-08-01',
            late_count: 2,
            recorded_day_count: 20,
            attendance_rate_percent: '72.5',
            risk_tier: 'HIGH',
            risk_score: '1.0000',
            open_case_count: 1,
            latest_case_at: '2026-07-06T00:00:00.000Z',
            teacher_comment: 'ความเห็นของครูที่ต้องมีสิทธิ์จึงจะเห็น',
          },
        ],
        totalCount: 1,
        summary: { HIGH: 1, WATCH: 0, NORMAL: 0 },
        caseStatusSummary: {
          OPEN: 0,
          IN_PROGRESS: 0,
          PENDING_REVIEW: 0,
          STUDENT_NOT_FOUND: 0,
        },
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
          studentPhotoUrl: '/api/students/student-1/photo?v=2026-08-10T06%3A30%3A00.000Z',
          riskTier: 'HIGH',
          termAbsentDays: 8,
          absenceResetAfterDate: '2026-08-01',
          attendanceRatePercent: 72.5,
          teacherComment: null,
        },
      ],
      meta: {
        page: 1,
        limit: 20,
        totalCount: 1,
        summary: { HIGH: 1, WATCH: 0, NORMAL: 0 },
        thresholds: { highAbsentDays: 4 },
      },
    });
    expect(taskRepository.listRiskDashboardStudents).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ riskTier: 'HIGH', sortBy: 'risk', sortDirection: 'desc' }),
      expect.objectContaining({ highAbsentDays: 4 }),
    );
  });

  // The gate used to name `manage-student-observations`, which
  // 20260821090000-CollapsePermissionsToPages folded into `students`. Nobody
  // held the retired id afterwards, so the column read `-` for every actor.
  it('shows the problem category and teacher comment to an actor holding the students page', async () => {
    const actor = {
      id: 8,
      username: 'school-admin',
      roles: ['SCHOOL_ADMIN'],
      permissions: ['dashboard', 'students'],
      data_scope: { school_ids: [101] },
    };
    const taskRepository = {
      getSystemSettingValue: jest.fn().mockResolvedValue('4'),
      listRiskDashboardStudents: jest.fn().mockResolvedValue({
        rows: [
          {
            student_uuid: 'student-1',
            student_name: 'เด็ก ทดสอบ',
            school_id: 101,
            grade: 'ม.1',
            room: '1',
            risk_tier: 'WATCH',
            problem_category_label: 'ปัญหาด้านสุขภาพ',
            concern_level_code: 'CONCERN',
            concern_level_label: 'น่ากังวล',
            teacher_comment: 'Covid',
          },
        ],
        totalCount: 1,
        summary: { HIGH: 0, WATCH: 1, NORMAL: 0 },
        caseStatusSummary: {
          OPEN: 0,
          IN_PROGRESS: 0,
          PENDING_REVIEW: 0,
          STUDENT_NOT_FOUND: 0,
        },
      }),
    };
    const taskPolicyService = { ensureActor: jest.fn().mockReturnValue(actor) };
    const service = new TaskStatsService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );

    await expect(
      service.getRiskDashboard(actor, { page: 1, limit: 20, sortBy: 'problemCategory' }),
    ).resolves.toMatchObject({
      data: [
        {
          studentId: 'student-1',
          problemCategoryLabel: 'ปัญหาด้านสุขภาพ',
          concernLevelCode: 'CONCERN',
          concernLevelLabel: 'น่ากังวล',
          teacherComment: 'Covid',
        },
      ],
    });
    expect(taskRepository.listRiskDashboardStudents).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ sortBy: 'problemCategory' }),
      expect.anything(),
    );
  });
});
