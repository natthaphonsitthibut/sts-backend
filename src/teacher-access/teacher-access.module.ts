import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import {
  PublicTeacherAccessController,
  TeacherAccessGrantController,
} from './teacher-access.controller';
import { TeacherAccessRepository } from './teacher-access.repository';
import { TeacherAccessService } from './teacher-access.service';

@Module({
  imports: [AuthModule, AttendanceModule, AutomationModule, RiskProfileModule],
  controllers: [TeacherAccessGrantController, PublicTeacherAccessController],
  providers: [TeacherAccessRepository, TeacherAccessService],
  exports: [TeacherAccessService],
})
export class TeacherAccessModule {}
