import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { ExecutiveReportingOverviewQueryDto } from './dto/executive-reporting.dto';
import { ExecutiveReportingService } from './executive-reporting.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('executive-report')
@Controller('api/executive-reporting')
export class ExecutiveReportingController {
  constructor(private readonly service: ExecutiveReportingService) {}

  @Get('overview')
  async getOverview(
    @Query() query: ExecutiveReportingOverviewQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.getOverview(actor, query);
  }
}
