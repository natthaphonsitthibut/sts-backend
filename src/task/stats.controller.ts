import { Controller, Get } from '@nestjs/common';
import { TaskService } from './task.service';

@Controller('api')
export class StatsController {
  constructor(private readonly taskService: TaskService) {}

  @Get('cases')
  async getCases() {
    return await this.taskService.getCases();
  }

  @Get('stats')
  async getStats() {
    return await this.taskService.getStats();
  }

  @Get('stats/overview')
  async getOverviewStats() {
    return await this.taskService.getOverviewStats();
  }
}
