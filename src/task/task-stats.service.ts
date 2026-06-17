import { Injectable, Logger } from '@nestjs/common';
import { getBangkokDateString } from '../common/utils/date.util';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import type { ActorContext } from './task.types';

@Injectable()
export class TaskStatsService {
  private readonly logger = new Logger(TaskStatsService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
  ) {}

  async getCases(actor?: ActorContext) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      return await this.taskRepository.listCasesWithActiveLinks(currentActor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getCases error: ${message}`);
      throw err;
    }
  }

  async getStats(actor?: ActorContext) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      const today = getBangkokDateString();

      return {
        total: await this.taskRepository.countCases(undefined, currentActor),
        open: await this.taskRepository.countCases('OPEN', currentActor),
        inProgress: await this.taskRepository.countCases('IN_PROGRESS', currentActor),
        resolved: await this.taskRepository.countCases('RESOLVED', currentActor),
        today: await this.taskRepository.countCasesCreatedOn(today, currentActor),
        pendingReview: await this.taskRepository.countCases('PENDING_REVIEW', currentActor),
        activeLinks: await this.taskRepository.countActiveTaskLinks(currentActor),
        delegations: 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getStats error: ${message}`);
      throw err;
    }
  }

  async getOverviewStats(actor?: ActorContext) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      return {
        success: true,
        data: {
          totalStudents: await this.taskRepository.countStudents(),
          dropoutStudents: await this.taskRepository.countStudentDropouts(),
          atRiskStudents: 0,
          helpStats: {
            waiting: await this.taskRepository.countCases('OPEN', currentActor),
            inProgress: await this.taskRepository.countCases('IN_PROGRESS', currentActor),
            resolved: await this.taskRepository.countCases('RESOLVED', currentActor),
          },
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getOverviewStats error: ${message}`);
      throw err;
    }
  }
}
