import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskModule } from './task/task.module';
import { AttendanceModule } from './attendance/attendance.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { MasterDataModule } from './master-data/master-data.module';
import { AutomationModule } from './automation/automation.module';
import { FilesModule } from './files/files.module';
import { FileStorageModule } from './files/storage/file-storage.module';
import { ImportsModule } from './imports/imports.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';

import { ConfigModule, type ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { StudentsModule } from './students/students.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { appConfig } from './config/app.config';
import { authConfig } from './config/auth.config';
import { databaseConfig } from './config/database.config';
import { emailConfig } from './config/email.config';
import { encryptionConfig } from './config/encryption.config';
import { geoConfig } from './config/geo.config';
import { lineConfig } from './config/line.config';
import { MessagingModule } from './common/messaging/messaging.module';
import { TeacherLineModule } from './teacher-line/teacher-line.module';
import { piiConfig } from './config/pii.config';
import { queueConfig } from './config/queue.config';
import { storageConfig } from './config/storage.config';
import { throttleConfig } from './config/throttle.config';
import { createTypeOrmOptions } from './database/typeorm.config';
import { GeoModule } from './geo/geo.module';
import { StatusCatalogModule } from './status-catalog/status-catalog.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TimetableModule } from './timetable/timetable.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { HomeDashboardModule } from './home-dashboard/home-dashboard.module';
import { DataExportsModule } from './data-exports/data-exports.module';
import { SchoolStructureModule } from './school-structure/school-structure.module';
import { TeachersModule } from './teachers/teachers.module';
import { CurriculumModule } from './curriculum/curriculum.module';
import { StudentObservationsModule } from './student-observations/student-observations.module';
import { StudentObservationSummaryModule } from './student-observation-summaries/student-observation-summary.module';
import { AraIdModule } from './araid/araid.module';
import { ObservationReviewsModule } from './observation-reviews/observation-reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        emailConfig,
        encryptionConfig,
        geoConfig,
        lineConfig,
        piiConfig,
        queueConfig,
        storageConfig,
        throttleConfig,
      ],
    }),
    FileStorageModule,
    MessagingModule,
    TeacherLineModule,
    ScheduleModule.forRoot(),
    // IP rate limiting (in-memory store). Limits come from the runtime config
    // (so .env overrides apply), exposed as named throttlers. The guard is
    // applied per-route via the Throttle* decorators (throttle.decorators.ts),
    // not globally, so only the sensitive credential endpoints are throttled.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [throttleConfig.KEY, RedisThrottlerStorage],
      useFactory: (config: ConfigType<typeof throttleConfig>, storage: RedisThrottlerStorage) => ({
        errorMessage: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งภายหลัง',
        storage,
        throttlers: [
          { name: 'login', ttl: config.login.ttlMs, limit: config.login.limit },
          { name: 'otpRequest', ttl: config.otpRequest.ttlMs, limit: config.otpRequest.limit },
          { name: 'otpVerify', ttl: config.otpVerify.ttlMs, limit: config.otpVerify.limit },
          { name: 'mockLogin', ttl: config.mockLogin.ttlMs, limit: config.mockLogin.limit },
          { name: 'geocode', ttl: config.geocode.ttlMs, limit: config.geocode.limit },
          {
            name: 'followerApplication',
            ttl: config.followerApplication.ttlMs,
            limit: config.followerApplication.limit,
          },
          {
            name: 'campaignLookup',
            ttl: config.campaignLookup.ttlMs,
            limit: config.campaignLookup.limit,
          },
          {
            name: 'teacherAccess',
            ttl: config.teacherAccess.ttlMs,
            limit: config.teacherAccess.limit,
          },
        ],
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => createTypeOrmOptions(config),
    }),
    AuthModule,
    TaskModule,
    AttendanceModule,
    UsersModule,
    SettingsModule,
    MasterDataModule,
    AutomationModule,
    StudentsModule,
    ImportsModule,
    FilesModule,
    AuditLogModule,
    GeoModule,
    StatusCatalogModule,
    NotificationsModule,
    SubjectsModule,
    TimetableModule,
    HomeDashboardModule,
    DataExportsModule,
    SchoolStructureModule,
    TeachersModule,
    CurriculumModule,
    StudentObservationsModule,
    ObservationReviewsModule,
    StudentObservationSummaryModule,
    AraIdModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
