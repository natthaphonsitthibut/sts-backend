import { ForbiddenException } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import { TaskSubmissionService } from './task-submission.service';

describe('TaskSubmissionService', () => {
  let service: TaskSubmissionService;
  let taskAccessService: jest.Mocked<Pick<TaskAccessService, 'getTaskByToken'>>;
  let taskRepository: jest.Mocked<
    Pick<TaskRepository, 'findTaskSubmissionContextByTokenHash' | 'listTaskStudents'>
  >;

  beforeEach(() => {
    taskAccessService = {
      getTaskByToken: jest.fn(),
    };
    taskRepository = {
      findTaskSubmissionContextByTokenHash: jest.fn(),
      listTaskStudents: jest.fn(),
    };

    service = new TaskSubmissionService(
      taskRepository as unknown as TaskRepository,
      taskAccessService as unknown as TaskAccessService,
      {} as AutomationService,
    );
  });

  it('rejects visit submission when OTP authentication is still required', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'VISIT',
      auth_required: true,
    });

    await expect(
      service.saveTaskSubmission('public-token', { notes: 'ตรวจเยี่ยม' }, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskRepository.findTaskSubmissionContextByTokenHash).not.toHaveBeenCalled();
  });

  it('passes the magic session token to attendance link validation', async () => {
    taskAccessService.getTaskByToken.mockResolvedValue({
      task_type: 'ATTENDANCE',
      auth_required: true,
    });

    await expect(
      service.saveTaskAttendance('public-token', [], 'verified-session-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(taskAccessService.getTaskByToken).toHaveBeenCalledWith(
      'public-token',
      'verified-session-token',
    );
  });
});
