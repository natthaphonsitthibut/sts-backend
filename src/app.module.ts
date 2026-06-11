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
import { ImportsModule } from './imports/imports.module';
import { AuthModule } from './auth/auth.module';

import { ConfigModule, type ConfigType } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { StudentsModule } from './students/students.module';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { emailConfig } from './config/email.config';
import { createTypeOrmOptions } from './database/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, emailConfig],
    }),
    ScheduleModule.forRoot(),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
