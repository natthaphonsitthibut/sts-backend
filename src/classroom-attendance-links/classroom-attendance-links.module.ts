import { Module } from '@nestjs/common';
import { AraIdModule } from '../araid/araid.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AuthModule } from '../auth/auth.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { GoogleLoginModule } from '../google-login/google-login.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';
import { TaskModule } from '../task/task.module';
import { TeacherCommentsModule } from '../teacher-comments/teacher-comments.module';
import { TeacherLineModule } from '../teacher-line/teacher-line.module';
import {
  ClassroomAttendanceLinksAdminController,
  ClassroomCheckInAuthController,
} from './classroom-attendance-links.controller';
import { ClassroomAttendanceLinksRepository } from './classroom-attendance-links.repository';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import { ClassroomLinkCookieService } from './classroom-link-cookie.service';
import { ClassroomLinkStudentsController } from './classroom-link-students.controller';
import { ClassroomLinkSessionStore } from './classroom-link-session.store';

@Module({
  imports: [
    AuthModule,
    AraIdModule,
    AuditLogModule,
    AttendanceModule,
    MessagingModule,
    GoogleLoginModule,
    SchoolStructureModule,
    StudentsModule,
    TaskModule,
    TeacherCommentsModule,
    TeacherLineModule,
    TokenEncryptionModule,
  ],
  controllers: [
    ClassroomAttendanceLinksAdminController,
    ClassroomCheckInAuthController,
    ClassroomLinkStudentsController,
  ],
  providers: [
    ClassroomAttendanceLinksRepository,
    ClassroomAttendanceLinksService,
    ClassroomLinkCookieService,
    ClassroomLinkSessionStore,
  ],
  exports: [ClassroomAttendanceLinksService],
})
export class ClassroomAttendanceLinksModule {}
