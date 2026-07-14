import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { CaseReportUpsService } from './case-report-ups.service';
import { CreateCaseReportUpDto, ListCaseReportUpsDto } from './dto/case-report-ups.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/cases')
export class CaseReportUpMutationController {
  constructor(private readonly service: CaseReportUpsService) {}

  @Post(':caseId/report-up')
  @RequirePermission('review-cases', 'report-up-cases')
  reportUp(
    @Param('caseId', ParseIntPipe) caseId: number,
    @Body() body: CreateCaseReportUpDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.reportUp(caseId, body, actor);
  }

  @Get(':caseId/report-ups')
  @RequirePermission('report-up-cases')
  listForCase(
    @Param('caseId', ParseIntPipe) caseId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listForCase(caseId, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/case-report-ups')
export class CaseReportUpQueueController {
  constructor(private readonly service: CaseReportUpsService) {}

  @Get()
  @RequirePermission('report-up-cases')
  list(@Query() query: ListCaseReportUpsDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.list(query, actor);
  }
}
