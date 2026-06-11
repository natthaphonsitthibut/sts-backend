import { Injectable, Logger } from '@nestjs/common';
import { TaskRepository } from './task.repository';

@Injectable()
export class TaskStatsService {
  private readonly logger = new Logger(TaskStatsService.name);

  constructor(private readonly taskRepository: TaskRepository) {}

  async getCases() {
    try {
      return await this.taskRepository.listCasesWithActiveLinks();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getCases error: ${message}`);
      throw err;
    }
  }

  async getStats() {
    try {
      const today = new Date().toISOString().split('T')[0];

      return {
        total: await this.taskRepository.countCases(),
        open: await this.taskRepository.countCases('OPEN'),
        inProgress: await this.taskRepository.countCases('IN_PROGRESS'),
        resolved: await this.taskRepository.countCases('RESOLVED'),
        today: await this.taskRepository.countCasesCreatedOn(today),
        pendingReview: await this.taskRepository.countCases('PENDING_REVIEW'),
        activeLinks: await this.taskRepository.countActiveTaskLinks(),
        delegations: 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getStats error: ${message}`);
      throw err;
    }
  }

  async getOverviewStats() {
    try {
      return {
        success: true,
        data: {
          totalStudents: await this.taskRepository.countStudents(),
          dropoutStudents: await this.taskRepository.countStudentDropouts(),
          atRiskStudents: 0,
          helpStats: {
            waiting: await this.taskRepository.countCases('OPEN'),
            inProgress: await this.taskRepository.countCases('IN_PROGRESS'),
            resolved: await this.taskRepository.countCases('RESOLVED'),
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
