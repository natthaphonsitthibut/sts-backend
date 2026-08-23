import { forwardRef, Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AraIdModule } from '../araid/araid.module';
import { AutomationModule } from '../automation/automation.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../common/email/email.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { StudentsModule } from '../students/students.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentObservationsModule } from '../student-observations/student-observations.module';
import { TimetableModule } from '../timetable/timetable.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { OtpModule } from '../common/otp/otp.module';
import { TeacherLineModule } from '../teacher-line/teacher-line.module';
import { TeacherAccessRepository } from './teacher-access.repository';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';
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
    SchoolStructureModule,
    forwardRef(() => StudentObservationsModule),
  ],
  // The assignment-bound link and attendance-delegation HTTP contracts are
  // retired. Keep the service temporarily because observation/review readers
  // still resolve historical provenance through it until destructive cleanup.
  controllers: [],
  providers: [TeacherAccessRepository, AraIdChallengeStore, TeacherAccessService],
  exports: [TeacherAccessService],
})
export class TeacherAccessModule {}
