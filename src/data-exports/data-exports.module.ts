import { Module } from '@nestjs/common';
import { DataExportsController } from './data-exports.controller';
import { DataExportsRepository } from './data-exports.repository';
import { DataExportsService } from './data-exports.service';

@Module({
  controllers: [DataExportsController],
  providers: [DataExportsService, DataExportsRepository],
})
export class DataExportsModule {}
