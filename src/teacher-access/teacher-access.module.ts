import { forwardRef, Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../common/email/email.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { StudentsModule } from '../students/students.module';
import { StudentObservationsModule } from '../student-observations/student-observations.module';
import {
  PublicTeacherAccessController,
  TeacherAccessGrantController,
} from './teacher-access.controller';
import { TeacherAccessOtpStore } from './teacher-access-otp.store';
import { TeacherAccessRepository } from './teacher-access.repository';
import { TeacherAccessService } from './teacher-access.service';

@Module({
  imports: [
    AuthModule,
    AttendanceModule,
    AutomationModule,
    RiskProfileModule,
    TokenEncryptionModule,
    EmailModule,
    StudentsModule,
    forwardRef(() => StudentObservationsModule),
  ],
  controllers: [TeacherAccessGrantController, PublicTeacherAccessController],
  providers: [TeacherAccessRepository, TeacherAccessService, TeacherAccessOtpStore],
  exports: [TeacherAccessService],
})
export class TeacherAccessModule {}
