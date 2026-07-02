import { Module } from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import { MasterDataController } from './master-data.controller';
import { MasterDataRepository } from './master-data.repository';
import { StudentStatusController } from './student-status.controller';
import { StudentStatusRepository } from './student-status.repository';
import { StudentStatusService } from './student-status.service';

@Module({
  controllers: [MasterDataController, StudentStatusController],
  providers: [
    MasterDataService,
    MasterDataRepository,
    StudentStatusService,
    StudentStatusRepository,
  ],
  exports: [MasterDataService, StudentStatusService],
})
export class MasterDataModule {}
