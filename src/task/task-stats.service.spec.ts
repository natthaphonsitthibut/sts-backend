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
      countStudentDropouts: jest.fn().mockResolvedValue(4),
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
        dropoutStudents: 4,
        atRiskStudents: 9,
        helpStats: {
          waiting: 3,
          inProgress: 5,
          resolved: 12,
        },
      },
    });
    expect(taskRepository.countAtRiskStudents).toHaveBeenCalledWith(actor);
  });
});
