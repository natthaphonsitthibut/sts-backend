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
  RequireGlobalScope,
  RequirePermission,
  RequireRoles,
  RolesGuard,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  CreateCodedMasterDataDto,
  CreateReferralAgencyDto,
  ListMasterDataQueryDto,
  UpdateCodedMasterDataDto,
  UpdateReferralAgencyDto,
} from './dto/master-data.dto';
import { MasterDataService } from './master-data.service';

@UseGuards(AuthGuard, PermissionsGuard, RolesGuard, GlobalScopeGuard)
@RequirePermission('master-data')
@RequireRoles('ADMIN')
@RequireGlobalScope()
@Controller('api/master-data')
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}

  @Get()
  getManifest() {
    return this.service.getManifest();
  }

  @Get('referral-agencies')
  listReferralAgencies(@Query() query: ListMasterDataQueryDto) {
    return this.service.listReferralAgencies(query);
  }

  @Post('referral-agencies')
  createReferralAgency(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: CreateReferralAgencyDto,
  ) {
    return this.service.createReferralAgency(actor, body);
  }

  @Put('referral-agencies/:id')
  updateReferralAgency(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateReferralAgencyDto,
  ) {
    return this.service.updateReferralAgency(actor, id, body);
  }

  @Delete('referral-agencies/:id')
  disableReferralAgency(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.disableReferralAgency(actor, id);
  }

  @Get(':catalog')
  listCoded(@Param('catalog') catalog: string, @Query() query: ListMasterDataQueryDto) {
    return this.service.listCoded(catalog, query);
  }

  @Post(':catalog')
  createCoded(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('catalog') catalog: string,
    @Body() body: CreateCodedMasterDataDto,
  ) {
    return this.service.createCoded(actor, catalog, body);
  }

  @Put(':catalog/:code')
  updateCoded(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('catalog') catalog: string,
    @Param('code') code: string,
    @Body() body: UpdateCodedMasterDataDto,
  ) {
    return this.service.updateCoded(actor, catalog, code, body);
  }

  @Delete(':catalog/:code')
  disableCoded(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('catalog') catalog: string,
    @Param('code') code: string,
  ) {
    return this.service.disableCoded(actor, catalog, code);
  }
}
