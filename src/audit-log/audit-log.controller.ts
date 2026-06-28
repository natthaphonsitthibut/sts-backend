import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from './audit-log.service';
import { GetAuditLogQueryDto } from './dto/audit-log.dto';

@UseGuards(AuthGuard)
@Controller('api/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async list(@Query() query: GetAuditLogQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.auditLogService.list(actor, {
      ...query,
      action: query.action?.trim() || undefined,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
    });
  }
}
