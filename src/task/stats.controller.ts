import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthenticatedRequestUser } from '../auth';
import { GetCasesQueryDto } from './dto/task.dto';
import { TaskService } from './task.service';

@UseGuards(AuthGuard)
@Controller('api')
export class StatsController {
  constructor(private readonly taskService: TaskService) {}

  @Get('cases')
  async getCases(
    @Query() query: GetCasesQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.taskService.getCases(actor, {
      status: query.status && query.status !== 'ALL' ? query.status : undefined,
      searchTerm: query.searchTerm?.trim() || undefined,
      page: query.page,
      limit: query.limit,
    });
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
