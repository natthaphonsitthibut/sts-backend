import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceLookupService } from './attendance-lookup.service';
import { AttendanceReadService } from './attendance-read.service';
import { AttendanceWriteService } from './attendance-write.service';

@Module({
  imports: [AuthModule, AutomationModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceRepository,
    AttendanceLookupService,
    AttendanceReadService,
    AttendanceWriteService,
    AttendanceService,
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
