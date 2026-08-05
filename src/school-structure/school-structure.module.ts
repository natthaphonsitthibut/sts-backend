import { Module } from '@nestjs/common';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { SchoolStructureController } from './school-structure.controller';
import { SchoolStructureRepository } from './school-structure.repository';
import { SchoolStructureService } from './school-structure.service';

@Module({
  imports: [RiskProfileModule],
  controllers: [SchoolStructureController],
  providers: [SchoolStructureRepository, SchoolStructureService],
  exports: [SchoolStructureService],
})
export class SchoolStructureModule {}
