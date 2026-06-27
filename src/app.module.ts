import { Module } from '@nestjs/common';
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
import { ImportsModule } from './imports/imports.module';
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
import { geoConfig } from './config/geo.config';
import { piiConfig } from './config/pii.config';
import { throttleConfig } from './config/throttle.config';
import { createTypeOrmOptions } from './database/typeorm.config';
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        emailConfig,
        geoConfig,
        piiConfig,
        throttleConfig,
      ],
    }),
    ScheduleModule.forRoot(),
    // IP rate limiting (in-memory store). Limits come from the runtime config
    // (so .env overrides apply), exposed as named throttlers. The guard is
    // applied per-route via the Throttle* decorators (throttle.decorators.ts),
    // not globally, so only the sensitive credential endpoints are throttled.
    ThrottlerModule.forRootAsync({
      inject: [throttleConfig.KEY],
      useFactory: (config: ConfigType<typeof throttleConfig>) => ({
        errorMessage: 'คำขอมากเกินไป กรุณาลองใหม่อีกครั้งภายหลัง',
        throttlers: [
          { name: 'login', ttl: config.login.ttlMs, limit: config.login.limit },
          { name: 'otpRequest', ttl: config.otpRequest.ttlMs, limit: config.otpRequest.limit },
          { name: 'otpVerify', ttl: config.otpVerify.ttlMs, limit: config.otpVerify.limit },
          { name: 'mockLogin', ttl: config.mockLogin.ttlMs, limit: config.mockLogin.limit },
          { name: 'geocode', ttl: config.geocode.ttlMs, limit: config.geocode.limit },
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
