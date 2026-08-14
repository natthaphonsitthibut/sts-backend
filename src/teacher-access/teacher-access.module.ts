import { forwardRef, Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AraIdModule } from '../araid/araid.module';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../common/email/email.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { StudentsModule } from '../students/students.module';
import { StudentObservationsModule } from '../student-observations/student-observations.module';
import { TimetableModule } from '../timetable/timetable.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { OtpModule } from '../common/otp/otp.module';
import { TeacherLineModule } from '../teacher-line/teacher-line.module';
import {
  PublicTeacherAccessController,
  TeacherAccessGrantController,
} from './teacher-access.controller';
import { TeacherAccessRepository } from './teacher-access.repository';
import { TeacherAccessAraIdChallengeStore } from './teacher-access-araid-challenge.store';
import { TeacherAccessService } from './teacher-access.service';

@Module({
  imports: [
    AuthModule,
    AraIdModule,
    AttendanceModule,
    AutomationModule,
    RiskProfileModule,
    TokenEncryptionModule,
    EmailModule,
    OtpModule,
    MessagingModule,
    TeacherLineModule,
    StudentsModule,
    TimetableModule,
    forwardRef(() => StudentObservationsModule),
  ],
  controllers: [TeacherAccessGrantController, PublicTeacherAccessController],
  providers: [TeacherAccessRepository, TeacherAccessAraIdChallengeStore, TeacherAccessService],
  exports: [TeacherAccessService],
})
export class TeacherAccessModule {}
