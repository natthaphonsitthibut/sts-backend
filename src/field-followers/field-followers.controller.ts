import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { ThrottleCampaignLookup, ThrottleFollowerApplication } from '../config/throttle.decorators';
import {
  CreateFollowerApplicationDto,
  ListFieldFollowersQueryDto,
  ReviewFieldFollowerDto,
} from './dto/field-followers.dto';
import { FieldFollowersService } from './field-followers.service';
import { FollowerRecruitmentCampaignService } from './follower-recruitment-campaign.service';

@Public()
@Controller('api/public/follower-applications')
export class PublicFollowerApplicationController {
  constructor(
    private readonly fieldFollowersService: FieldFollowersService,
    private readonly campaignService: FollowerRecruitmentCampaignService,
  ) {}

  @ThrottleCampaignLookup()
  @Get('campaign/:code')
  async getCampaign(@Param('code') code: string) {
    return await this.campaignService.getPublicCampaignInfo(code);
  }

  @ThrottleFollowerApplication()
  @Post()
  async apply(@Body() body: CreateFollowerApplicationDto, @Req() req: Request) {
    return await this.fieldFollowersService.createApplication(body, { ip: req.ip ?? null });
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('field-monitor')
@Controller('api/field-followers')
export class FieldFollowersController {
  constructor(private readonly fieldFollowersService: FieldFollowersService) {}

  @Get()
  async list(
    @Query() query: ListFieldFollowersQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.fieldFollowersService.listFollowers(actor, query);
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return await this.fieldFollowersService.getFollower(id, actor);
  }

  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @Body() body: ReviewFieldFollowerDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return await this.fieldFollowersService.reviewFollower(id, body.action, actor, {
      ip: req.ip ?? null,
    });
  }
}
