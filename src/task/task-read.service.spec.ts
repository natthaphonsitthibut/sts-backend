import { TaskAccessService } from './task-access.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskReadService } from './task-read.service';
import { TaskRepository } from './task.repository';

describe('TaskReadService', () => {
  it('preserves delegation actor fields in chain order', async () => {
    const actor = {
      id: 1,
      username: 'reviewer',
      roles: ['DIRECTOR'],
      permissions: ['review-cases'],
      data_scope: {},
    };
    const taskRepository = {
      findTaskChainTask: jest.fn().mockResolvedValue({
        id: 'task-id',
        case_id: null,
        task_type: 'VISIT',
        target_grade: null,
        target_room: null,
        resolved_target_grade: 'ม.6',
        resolved_target_room: '2',
        status: 'IN_PROGRESS',
      }),
      listTaskLinksByTaskId: jest.fn().mockResolvedValue([
        {
          id: 'root-link',
          assigned_to_name: 'ผู้รับเริ่มต้น',
          delegation_depth: 0,
          delegated_by_name: null,
          delegated_at: null,
        },
        {
          id: 'child-link',
          assigned_to_name: 'ผู้รับถัดไป',
          delegation_depth: 1,
          delegated_by_name: 'ผู้รับเริ่มต้น',
          delegated_at: '2026-06-27T05:00:00.000Z',
        },
      ]),
      findTaskSubmissionByLinkId: jest.fn().mockResolvedValue(null),
    };
    const taskPolicyService = {
      ensureActor: jest.fn().mockReturnValue(actor),
    };
    const service = new TaskReadService(
      taskRepository as unknown as TaskRepository,
      {} as TaskAccessService,
      taskPolicyService as unknown as TaskPolicyService,
    );

    const result = await service.getTaskChain(actor, 'task-id');

    expect(result?.chain).toEqual([
      expect.objectContaining({
        id: 'root-link',
        delegated_by_name: null,
      }),
      expect.objectContaining({
        id: 'child-link',
        delegated_by_name: 'ผู้รับเริ่มต้น',
        delegated_at: '2026-06-27T05:00:00.000Z',
      }),
    ]);
    expect(result).toMatchObject({
      target_grade: 'ม.6',
      target_room: '2',
    });
    expect(taskRepository.findTaskSubmissionByLinkId).toHaveBeenCalledTimes(2);
  });
});
