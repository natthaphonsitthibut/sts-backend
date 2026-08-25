import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, PermissionsGuard, RequireAnyPermission } from '../auth';
import { listStaffPiiRevealReasons } from './pii-fields.config';

@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission(
  'students',
  'manage-students',
  'teachers',
  'manage-teachers',
  'manage-users-list',
)
@Controller('api/pii')
export class PiiAccessController {
  @Get('reveal-options')
  listRevealOptions() {
    return { data: listStaffPiiRevealReasons() };
  }
}
