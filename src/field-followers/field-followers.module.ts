import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StudentGeocodeModule } from '../student-geocode/student-geocode.module';
import {
  FieldFollowersController,
  PublicFollowerApplicationController,
} from './field-followers.controller';
import { FieldFollowersRepository } from './field-followers.repository';
import { FieldFollowersService } from './field-followers.service';
import { FieldMonitorMapController } from './field-monitor-map.controller';
import { FieldMonitorMapRepository } from './field-monitor-map.repository';
import { FieldMonitorMapService } from './field-monitor-map.service';

@Module({
  imports: [AuditLogModule, StudentGeocodeModule],
  controllers: [
    PublicFollowerApplicationController,
    FieldFollowersController,
    FieldMonitorMapController,
  ],
  providers: [
    FieldFollowersRepository,
    FieldFollowersService,
    FieldMonitorMapRepository,
    FieldMonitorMapService,
  ],
})
export class FieldFollowersModule {}
