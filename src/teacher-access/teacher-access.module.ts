import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { TeacherAccessRepository } from './teacher-access.repository';
import { TeacherAccessService } from './teacher-access.service';

@Module({
  imports: [AuthModule, AttendanceModule, AutomationModule, RiskProfileModule],
  // Controllers are intentionally not registered: teachers now use normal
  // user accounts. The service remains injectable only so historical records
  // and a future revert do not require destructive schema changes.
  controllers: [],
  providers: [TeacherAccessRepository, TeacherAccessService],
  exports: [TeacherAccessService],
})
export class TeacherAccessModule {}
