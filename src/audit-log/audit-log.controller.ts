import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { AuditLogService } from './audit-log.service';
import { GetAuditLogQueryDto } from './dto/audit-log.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get(':id')
  @RequirePermission('audit-log')
  async getById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.auditLogService.getById(actor, id);
  }

  @Get()
  @RequirePermission('audit-log')
  async list(@Query() query: GetAuditLogQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.auditLogService.list(actor, {
      ...query,
      action: query.action?.trim() || undefined,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      targetType: query.targetType?.trim() || undefined,
      targetId: query.targetId?.trim() || undefined,
    });
  }
}
