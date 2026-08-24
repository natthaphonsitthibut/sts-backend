import { Module } from '@nestjs/common';
import { StudentStatusController } from './student-status.controller';
import { StudentStatusRepository } from './student-status.repository';
import { StudentStatusService } from './student-status.service';
import { MasterDataController } from './master-data.controller';
import { MasterDataRepository } from './master-data.repository';
import { MasterDataService } from './master-data.service';

/**
 * National master data with concrete attendance, student-care, import and case
 * consumers. Administrative writes stay behind the global ADMIN boundary;
 * consumer modules receive active options through the service instead of a
 * second public CRUD contract.
 */
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
