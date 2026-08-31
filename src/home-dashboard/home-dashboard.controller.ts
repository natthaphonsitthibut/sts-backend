import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { HomeDashboardQueryDto } from './dto/home-dashboard.dto';
import { HomeDashboardService } from './home-dashboard.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('home')
@Controller('api/home-dashboard')
export class HomeDashboardController {
  constructor(private readonly homeDashboardService: HomeDashboardService) {}

  @Get('summary')
  async getSummary(
    @Query() query: HomeDashboardQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.homeDashboardService.getSummary(actor, query);
  }

  @Get('trends')
  async getTrends(
    @Query() query: HomeDashboardQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.homeDashboardService.getTrends(actor, query);
  }

  @Get('follow-up-insights')
  async getFollowUpInsights(
    @Query() query: HomeDashboardQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.homeDashboardService.getFollowUpInsights(actor, query);
  }

  @Get('filter-options')
  async getFilterOptions(
    @Query() query: HomeDashboardQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.homeDashboardService.getFilterOptions(actor, query);
  }
}
