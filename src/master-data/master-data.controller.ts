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
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { CurrentUser } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { PaginatedSearchQueryDto } from '../common/pagination/pagination.dto';
import { UpsertMasterDataItemDto } from './dto/master-data.dto';
import { CreateSchoolMasterDataDto, UpdateSchoolMasterDataDto } from './dto/school-master-data.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/master-data')
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Get('schools')
  @RequirePermission('manage-schools')
  listSchools(
    @Query() query: PaginatedSearchQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.masterDataService.listSchools(actor, query);
  }

  @Get('schools/:id')
  @RequirePermission('manage-schools')
  getSchool(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.masterDataService.getSchool(actor, id);
  }

  @Post('schools')
  @RequirePermission('manage-schools')
  createSchool(
    @Body() body: CreateSchoolMasterDataDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.masterDataService.createSchool(actor, body);
  }

  @Put('schools/:id')
  @RequirePermission('manage-schools')
  updateSchool(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSchoolMasterDataDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.masterDataService.updateSchool(actor, id, body);
  }

  @Delete('schools/:id')
  @RequirePermission('manage-schools')
  disableSchool(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.masterDataService.disableSchool(actor, id);
  }

  @Get(':table')
  @RequirePermission('settings')
  getAll(@Param('table') table: string, @Query() query: PaginatedSearchQueryDto) {
    return this.masterDataService.getAll(table, {
      page: query.page,
      limit: query.limit,
      searchTerm: query.searchTerm,
    });
  }

  @Get(':table/:id')
  @RequirePermission('settings')
  getById(@Param('table') table: string, @Param('id', ParseIntPipe) id: number) {
    return this.masterDataService.getById(table, id);
  }

  @Post(':table')
  @RequirePermission('settings')
  create(@Param('table') table: string, @Body() body: UpsertMasterDataItemDto) {
    return this.masterDataService.create(table, body);
  }

  @Put(':table/:id')
  @RequirePermission('settings')
  update(
    @Param('table') table: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpsertMasterDataItemDto,
  ) {
    return this.masterDataService.update(table, id, body);
  }

  @Delete(':table/:id')
  @RequirePermission('settings')
  remove(@Param('table') table: string, @Param('id', ParseIntPipe) id: number) {
    return this.masterDataService.remove(table, id);
  }
}
