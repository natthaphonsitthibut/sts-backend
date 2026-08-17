import { Module } from '@nestjs/common';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceImportService } from './attendance-import.service';
import { AttendanceImportHistoryRepository } from './attendance-import-history.repository';
import { FileStorageModule } from '../files/storage/file-storage.module';
import { AttendanceLookupService } from './attendance-lookup.service';
import { AttendanceReadService } from './attendance-read.service';
import { AttendanceWriteService } from './attendance-write.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';
import { PublicLocationsController } from './public-locations.controller';

@Module({
  imports: [
    AuthModule,
    AutomationModule,
    RiskProfileModule,
    TokenEncryptionModule,
    FileStorageModule,
  ],
  controllers: [AttendanceController, PublicLocationsController],
  providers: [
    AttendanceRepository,
    AttendanceImportService,
    AttendanceLookupService,
    AttendanceReadService,
    AttendanceWriteService,
    AttendanceOperationsRepository,
    AttendanceOperationsService,
    AttendanceService,
    AttendanceImportHistoryRepository,
  ],
  exports: [AttendanceService, AttendanceWriteService, AttendanceImportService],
})
export class AttendanceModule {}
