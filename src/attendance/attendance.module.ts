import { Module } from '@nestjs/common';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceLookupService } from './attendance-lookup.service';
import { AttendanceReadService } from './attendance-read.service';
import { AttendanceWriteService } from './attendance-write.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';

@Module({
  imports: [
    AuthModule,
    AutomationModule,
    NotificationsModule,
    RiskProfileModule,
    TokenEncryptionModule,
  ],
  controllers: [AttendanceController],
  providers: [
    AttendanceRepository,
    AttendanceLookupService,
    AttendanceReadService,
    AttendanceWriteService,
    AttendanceOperationsRepository,
    AttendanceOperationsService,
    AttendanceService,
  ],
  exports: [AttendanceService, AttendanceWriteService],
})
export class AttendanceModule {}
