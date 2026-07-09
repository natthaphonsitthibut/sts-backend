import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StudentGeocodeModule } from '../student-geocode/student-geocode.module';
import { TaskModule } from '../task/task.module';
import {
  FieldFollowersController,
  PublicFollowerApplicationController,
} from './field-followers.controller';
import { FieldFollowersRepository } from './field-followers.repository';
import { FieldFollowersService } from './field-followers.service';
import { FieldMonitorMapController } from './field-monitor-map.controller';
import { FieldMonitorMapRepository } from './field-monitor-map.repository';
import { FieldMonitorMapService } from './field-monitor-map.service';
import { FollowerRecruitmentCampaignController } from './follower-recruitment-campaign.controller';
import { FollowerRecruitmentCampaignRepository } from './follower-recruitment-campaign.repository';
import { FollowerRecruitmentCampaignService } from './follower-recruitment-campaign.service';

@Module({
  imports: [AuditLogModule, StudentGeocodeModule, TaskModule],
  controllers: [
    PublicFollowerApplicationController,
    FieldFollowersController,
    FieldMonitorMapController,
    FollowerRecruitmentCampaignController,
  ],
  providers: [
    FieldFollowersRepository,
    FieldFollowersService,
    FieldMonitorMapRepository,
    FieldMonitorMapService,
    FollowerRecruitmentCampaignRepository,
    FollowerRecruitmentCampaignService,
  ],
})
export class FieldFollowersModule {}
