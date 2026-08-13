import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { GetCasesQueryDto, GetRiskDashboardQueryDto } from './dto/task.dto';
import { TaskService } from './task.service';

@UseGuards(AuthGuard)
@Controller('api')
export class StatsController {
  constructor(private readonly taskService: TaskService) {}

  @Get('cases')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('review-cases')
  async getCases(
    @Query() query: GetCasesQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.taskService.getCases(actor, {
      status: query.status && query.status !== 'ALL' ? query.status : undefined,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      grade: query.grade?.trim() || undefined,
      room: query.room?.trim() || undefined,
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

  @Get('dashboard/risk-watchlist')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('dashboard')
  async getRiskDashboard(
    @Query() query: GetRiskDashboardQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.taskService.getRiskDashboard(actor, {
      studentGroup: query.studentGroup,
      riskTier: query.riskTier && query.riskTier !== 'ALL' ? query.riskTier : undefined,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      academicYear: query.academicYear,
      semester: query.semester,
      caseStatus: query.caseStatus,
      grade: query.grade?.trim() || undefined,
      room: query.room?.trim() || undefined,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
    });
  }
}
