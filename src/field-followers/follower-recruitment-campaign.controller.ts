import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  AddFollowerCampaignTargetsDto,
  AssignFollowerCampaignTargetDto,
  CreateFollowerRecruitmentCampaignDto,
  UpdateFollowerRecruitmentCampaignDto,
} from './dto/follower-recruitment-campaign.dto';
import { FollowerRecruitmentCampaignService } from './follower-recruitment-campaign.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('field-monitor')
@Controller('api/follower-recruitment-campaigns')
export class FollowerRecruitmentCampaignController {
  constructor(private readonly service: FollowerRecruitmentCampaignService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.service.list(actor);
  }

  @Post()
  async create(
    @Body() body: CreateFollowerRecruitmentCampaignDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.create(body, actor, { ip: req.ip ?? null });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateFollowerRecruitmentCampaignDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.update(id, body, actor, { ip: req.ip ?? null });
  }

  @Get(':id/targets')
  async listTargets(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.service.listTargets(id, actor);
  }

  @Post(':id/targets')
  async addTargets(
    @Param('id') id: string,
    @Body() body: AddFollowerCampaignTargetsDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.addTargets(id, body, actor, { ip: req.ip ?? null });
  }

  @Post('targets/:targetId/assign-preview')
  async prepareAssignment(
    @Param('targetId') targetId: string,
    @Body() body: AssignFollowerCampaignTargetDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.prepareTargetAssignment(targetId, body, actor);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.service.remove(id, actor, { ip: req.ip ?? null });
  }
}
