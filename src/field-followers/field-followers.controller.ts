import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { processVisitPhoto } from '../common/file-upload/visit-photo.util';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { ThrottleCampaignLookup, ThrottleFollowerApplication } from '../config/throttle.decorators';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
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
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
  ) {}

  @ThrottleCampaignLookup()
  @Get('campaign/:code')
  async getCampaign(@Param('code') code: string) {
    return await this.campaignService.getPublicCampaignInfo(code);
  }

  @ThrottleFollowerApplication()
  @Post('id-card-photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async uploadIdCardPhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('กรุณาอัปโหลดรูปบัตร');
    }
    const filename = await processVisitPhoto(file, this.storage);
    return {
      success: true,
      data: {
        filename,
        url: `/uploads/field-follower-id-cards/${filename}`,
      },
    };
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
