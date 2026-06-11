import { Module } from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import { MasterDataController } from './master-data.controller';
import { MasterDataRepository } from './master-data.repository';

@Module({
  controllers: [MasterDataController],
  providers: [MasterDataService, MasterDataRepository],
  exports: [MasterDataService],
})
export class MasterDataModule {}
