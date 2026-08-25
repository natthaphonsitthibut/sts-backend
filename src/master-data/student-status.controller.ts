import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  GlobalScopeGuard,
  PermissionsGuard,
  RequireAnyPermission,
  RequireGlobalScope,
  RequirePermission,
  RequireRoles,
  RolesGuard,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  CreateStudentStatusDto,
  ListStudentStatusesQueryDto,
  UpdateStudentStatusDto,
} from './dto/student-status.dto';
import { StudentStatusService } from './student-status.service';

@UseGuards(AuthGuard, PermissionsGuard, RolesGuard, GlobalScopeGuard)
@Controller('api/student-statuses')
export class StudentStatusController {
  constructor(private readonly service: StudentStatusService) {}

  // Read access covers list/search screens and import admins without granting
  // settings management; mutations remain settings-only.
  @Get()
  @RequireAnyPermission('master-data', 'settings', 'import-data', 'students', 'manage-students')
  list(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListStudentStatusesQueryDto,
  ) {
    return this.service.list(query, {
      includeTechnical:
        actor.permissions.includes('master-data') && actor.data_scope?.global === true,
    });
  }

  @Get(':code')
  @RequirePermission('master-data')
  @RequireRoles('ADMIN')
  @RequireGlobalScope()
  getByCode(@Param('code', ParseIntPipe) code: number) {
    return this.service.getByCode(code);
  }

  @Post()
  @RequirePermission('master-data')
  @RequireRoles('ADMIN')
  @RequireGlobalScope()
  create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() body: CreateStudentStatusDto) {
    return this.service.create(actor, body);
  }

  @Put(':code')
  @RequirePermission('master-data')
  @RequireRoles('ADMIN')
  @RequireGlobalScope()
  update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
    @Body() body: UpdateStudentStatusDto,
  ) {
    return this.service.update(actor, code, body);
  }

  @Delete(':code')
  @RequirePermission('master-data')
  @RequireRoles('ADMIN')
  @RequireGlobalScope()
  disable(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('code', ParseIntPipe) code: number,
  ) {
    return this.service.disable(actor, code);
  }
}
