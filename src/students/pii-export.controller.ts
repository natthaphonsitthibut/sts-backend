import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  CreatePiiExportRequestDto,
  DownloadPiiExportQueryDto,
  ListPiiExportRequestsQueryDto,
  RejectPiiExportRequestDto,
} from './dto/pii-export.dto';
import { PiiExportService } from './pii-export.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
@Controller('api/students/pii-export-requests')
export class PiiExportController {
  constructor(private readonly piiExportService: PiiExportService) {}

  @Post()
  create(
    @Body() body: CreatePiiExportRequestDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.piiExportService.createRequest(actor, body, { ip: req.ip ?? null });
  }

  @Get()
  list(
    @Query() query: ListPiiExportRequestsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.piiExportService.listRequests(actor, query);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.piiExportService.approveRequest(id, actor, { ip: req.ip ?? null });
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() body: RejectPiiExportRequestDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.piiExportService.rejectRequest(id, actor, body.rejected_reason, {
      ip: req.ip ?? null,
    });
  }
}

@Public()
@Controller('api/students/pii-export-download')
export class PiiExportDownloadController {
  constructor(private readonly piiExportService: PiiExportService) {}

  @Get()
  async download(
    @Query() query: DownloadPiiExportQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.piiExportService.download(query.token, { ip: req.ip ?? null });
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="${result.filename}"`);
    return result.csv;
  }
}
