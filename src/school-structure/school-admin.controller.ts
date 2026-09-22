import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  GlobalScopeGuard,
  PermissionsGuard,
  RequireGlobalScope,
  RequirePermission,
  RequireRoles,
  RolesGuard,
} from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  CreateSchoolDto,
  ListSchoolsQueryDto,
  ListAdministrativeDistrictsDto,
  ListAdministrativeSubDistrictsDto,
  UpdateSchoolDto,
} from './dto/school-structure.dto';
import { SchoolStructureService } from './school-structure.service';

/** Global school master-data CRUD, kept separate from school-scoped structure routes. */
@UseGuards(AuthGuard, PermissionsGuard, RolesGuard, GlobalScopeGuard)
@RequirePermission('manage-schools')
@RequireRoles('ADMIN')
@RequireGlobalScope()
@Controller('api')
export class SchoolAdminController {
  constructor(private readonly service: SchoolStructureService) {}

  @Get('schools')
  listSchools(@Query() query: ListSchoolsQueryDto) {
    return this.service.listSchoolsForAdmin(query);
  }

  @Post('schools')
  createSchool(@Body() body: CreateSchoolDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.createSchool(body, actor);
  }

  @Patch('schools/:schoolId')
  updateSchool(
    @Param('schoolId', ParseIntPipe) schoolId: number,
    @Body() body: UpdateSchoolDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateSchool(schoolId, body, actor);
  }

  @Delete('schools/:schoolId')
  deactivateSchool(
    @Param('schoolId', ParseIntPipe) schoolId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deactivateSchool(schoolId, actor);
  }

  @Get('administrative-areas/provinces')
  listProvinces() {
    return this.service.listAdministrativeProvinces();
  }

  @Get('administrative-areas/districts')
  listDistricts(@Query() query: ListAdministrativeDistrictsDto) {
    return this.service.listAdministrativeDistricts(query);
  }

  @Get('administrative-areas/sub-districts')
  listSubDistricts(@Query() query: ListAdministrativeSubDistrictsDto) {
    return this.service.listAdministrativeSubDistricts(query);
  }
}
