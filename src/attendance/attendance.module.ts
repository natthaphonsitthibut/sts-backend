import { Module } from '@nestjs/common';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AuthModule } from '../auth/auth.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { AttendanceRepository } from './attendance.repository';
import { FileStorageModule } from '../files/storage/file-storage.module';
import { AttendanceLookupService } from './attendance-lookup.service';
import { AttendanceReadService } from './attendance-read.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';
import { PublicLocationsController } from './public-locations.controller';
import { ExceptionAttendanceRepository } from './exception-attendance.repository';
import { ExceptionAttendanceService } from './exception-attendance.service';
import { AttendanceImportService } from './attendance-import.service';

@Module({
  imports: [AuthModule, RiskProfileModule, TokenEncryptionModule, FileStorageModule],
  controllers: [AttendanceController, PublicLocationsController],
  providers: [
    AttendanceRepository,
    AttendanceLookupService,
    AttendanceReadService,
    AttendanceOperationsRepository,
    AttendanceOperationsService,
    AttendanceService,
    ExceptionAttendanceRepository,
    ExceptionAttendanceService,
    AttendanceImportService,
  ],
  exports: [AttendanceService, ExceptionAttendanceService],
})
export class AttendanceModule {}
