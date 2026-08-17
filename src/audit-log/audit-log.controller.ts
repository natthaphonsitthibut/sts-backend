import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { AuditLogService } from './audit-log.service';
import { GetAuditLogActionsQueryDto, GetAuditLogQueryDto } from './dto/audit-log.dto';

/**
 * บันทึกการใช้งาน is a panel, not a page: it is embedded in นำเข้าข้อมูล
 * (`import-data`), รายชื่อนักเรียน (`students`) and the link detail screen, which
 * is reached from a case and so is guarded by รายงานสถานะนักเรียน (`dashboard`).
 * Each of those pages can read it, plus the standalone `audit-log` permission for
 * anyone who should see the log without owning any of them.
 *
 * The link detail screen used to sit behind `home`, which every account holds —
 * accepting that here would have made the whole log world-readable, so the screen
 * moved to `dashboard` instead of this endpoint moving to `home`.
 */
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('actions')
  @RequireAnyPermission('audit-log', 'import-data', 'students', 'dashboard')
  getActions(
    @Query() query: GetAuditLogActionsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.auditLogService.getActionOptions(actor, query);
  }

  @Get(':id')
  @RequireAnyPermission('audit-log', 'import-data', 'students', 'dashboard')
  async getById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.auditLogService.getById(actor, id);
  }

  @Get()
  @RequireAnyPermission('audit-log', 'import-data', 'students', 'dashboard')
  async list(@Query() query: GetAuditLogQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.auditLogService.list(actor, {
      ...query,
      action: query.action,
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      targetType: query.targetType?.trim() || undefined,
      targetId: query.targetId?.trim() || undefined,
    });
  }
}
