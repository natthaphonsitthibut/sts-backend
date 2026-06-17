import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthenticatedRequestUser } from '../auth';
import { TaskService } from './task.service';

@UseGuards(AuthGuard)
@Controller('api')
export class StatsController {
  constructor(private readonly taskService: TaskService) {}

  @Get('cases')
  async getCases(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.taskService.getCases(actor);
  }

  @Get('stats')
  async getStats(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.taskService.getStats(actor);
  }

  @Get('stats/overview')
  async getOverviewStats(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.taskService.getOverviewStats(actor);
  }
}
