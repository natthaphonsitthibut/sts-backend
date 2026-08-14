import { TaskAccessService } from './task-access.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskReadService } from './task-read.service';
import { TaskRepository } from './task.repository';
import { TaskService } from './task.service';
import { TaskStatsService } from './task-stats.service';
import { TaskSubmissionService } from './task-submission.service';

describe('TaskService public task response', () => {
  it('does not expose the assignee email from a public token response', async () => {
    const taskAccessService = {
      getTaskByToken: jest.fn().mockResolvedValue({
        task_id: 'task-1',
        assigned_to_name: 'ครูทดสอบ',
        assigned_to_email: 'teacher@example.test',
        auth_required: true,
      }),
    };
    const service = new TaskService(
      {} as TaskLifecycleService,
      taskAccessService as unknown as TaskAccessService,
      {} as TaskReadService,
      {} as TaskSubmissionService,
      {} as TaskStatsService,
      {} as TaskRepository,
    );

    await expect(service.getTaskByToken('public-token')).resolves.toEqual({
      task_id: 'task-1',
      assigned_to_name: 'ครูทดสอบ',
      auth_required: true,
    });
  });
});
