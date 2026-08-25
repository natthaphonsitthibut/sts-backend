import { Module } from '@nestjs/common';
import { AraIdModule } from '../araid/araid.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { GoogleLoginModule } from '../google-login/google-login.module';
import { TeacherLineModule } from '../teacher-line/teacher-line.module';
import {
  ClassroomAttendanceLinksAdminController,
  ClassroomCheckInAuthController,
} from './classroom-attendance-links.controller';
import { ClassroomAttendanceLinksRepository } from './classroom-attendance-links.repository';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import { ClassroomLinkCookieService } from './classroom-link-cookie.service';
import { ClassroomLinkSessionStore } from './classroom-link-session.store';

@Module({
  imports: [
    AuthModule,
    AraIdModule,
    AuditLogModule,
    AttendanceModule,
    MessagingModule,
    GoogleLoginModule,
    TeacherLineModule,
    TokenEncryptionModule,
  ],
  controllers: [ClassroomAttendanceLinksAdminController, ClassroomCheckInAuthController],
  providers: [
    ClassroomAttendanceLinksRepository,
    ClassroomAttendanceLinksService,
    ClassroomLinkCookieService,
    ClassroomLinkSessionStore,
  ],
  exports: [ClassroomAttendanceLinksService],
})
export class ClassroomAttendanceLinksModule {}
