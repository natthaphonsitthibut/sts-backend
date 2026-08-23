import { Module } from '@nestjs/common';
import { AraIdModule } from '../araid/araid.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import {
  ClassroomAttendanceLinksAdminController,
  ClassroomCheckInAuthController,
} from './classroom-attendance-links.controller';
import { ClassroomAttendanceLinksRepository } from './classroom-attendance-links.repository';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import { ClassroomLinkCookieService } from './classroom-link-cookie.service';
import { ClassroomLinkSessionStore } from './classroom-link-session.store';
import { GoogleLoginStateStore } from './google-login-state.store';
import { GoogleOidcProvider } from './google-oidc.provider';

@Module({
  imports: [
    AuthModule,
    AraIdModule,
    AuditLogModule,
    AttendanceModule,
    MessagingModule,
    TokenEncryptionModule,
  ],
  controllers: [ClassroomAttendanceLinksAdminController, ClassroomCheckInAuthController],
  providers: [
    ClassroomAttendanceLinksRepository,
    ClassroomAttendanceLinksService,
    ClassroomLinkCookieService,
    ClassroomLinkSessionStore,
    GoogleLoginStateStore,
    GoogleOidcProvider,
  ],
  exports: [ClassroomAttendanceLinksService],
})
export class ClassroomAttendanceLinksModule {}
