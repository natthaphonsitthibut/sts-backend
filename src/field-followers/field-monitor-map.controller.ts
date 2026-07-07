import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { FieldMonitorMapQueryDto } from './dto/field-monitor-map.dto';
import { FieldMonitorMapService } from './field-monitor-map.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('field-monitor')
@Controller('api/field-monitor')
export class FieldMonitorMapController {
  constructor(private readonly fieldMonitorMapService: FieldMonitorMapService) {}

  @Get('map')
  async getMap(
    @Query() query: FieldMonitorMapQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() req: Request,
  ) {
    return await this.fieldMonitorMapService.getMapPins(query.studentUuids, actor, {
      ip: req.ip ?? null,
    });
  }
}
