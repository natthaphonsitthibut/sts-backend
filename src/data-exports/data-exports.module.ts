import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { executiveReportingConfig } from '../config/executive-reporting.config';
import { DataExportsController } from './data-exports.controller';
import { DataExportsRepository } from './data-exports.repository';
import { DataExportsService } from './data-exports.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { StatusCatalogModule } from '../status-catalog/status-catalog.module';

@Module({
  imports: [
    ConfigModule.forFeature(executiveReportingConfig),
    AttendanceModule,
    StatusCatalogModule,
  ],
  controllers: [DataExportsController],
  providers: [DataExportsService, DataExportsRepository],
})
export class DataExportsModule {}
