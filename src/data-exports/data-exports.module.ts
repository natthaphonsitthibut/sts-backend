import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { executiveReportingConfig } from '../config/executive-reporting.config';
import { DataExportsController } from './data-exports.controller';
import { DataExportsRepository } from './data-exports.repository';
import { DataExportsService } from './data-exports.service';

@Module({
  imports: [ConfigModule.forFeature(executiveReportingConfig)],
  controllers: [DataExportsController],
  providers: [DataExportsService, DataExportsRepository],
})
export class DataExportsModule {}
