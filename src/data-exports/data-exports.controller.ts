import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { DataExportsService } from './data-exports.service';
import { CreateDataExportJobDto, DataExportJobListQueryDto } from './dto/data-export.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('export-data')
@Controller('api/data-exports')
export class DataExportsController {
  constructor(private readonly dataExportsService: DataExportsService) {}

  @Get('catalog')
  getCatalog(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.dataExportsService.getCatalog(actor);
  }

  @Post('jobs')
  @HttpCode(202)
  async createJob(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() dto: CreateDataExportJobDto,
  ) {
    return await this.dataExportsService.createJob(actor, dto);
  }

  @Get('jobs')
  async listJobs(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: DataExportJobListQueryDto,
  ) {
    return await this.dataExportsService.listJobs(actor, query);
  }

  @Get('jobs/:jobId')
  async getJob(@CurrentUser() actor: AuthenticatedRequestUser, @Param('jobId') jobId: string) {
    return await this.dataExportsService.getJob(actor, jobId);
  }

  @Post('jobs/:jobId/cancel')
  async cancelJob(@CurrentUser() actor: AuthenticatedRequestUser, @Param('jobId') jobId: string) {
    return await this.dataExportsService.cancelJob(actor, jobId);
  }

  @Post('jobs/:jobId/retry')
  async retryJob(@CurrentUser() actor: AuthenticatedRequestUser, @Param('jobId') jobId: string) {
    return await this.dataExportsService.retryJob(actor, jobId);
  }

  @Get('jobs/:jobId/download')
  async downloadJob(@CurrentUser() actor: AuthenticatedRequestUser, @Param('jobId') jobId: string) {
    return await this.dataExportsService.downloadJob(actor, jobId);
  }
}
