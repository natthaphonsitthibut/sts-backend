import { Module } from '@nestjs/common';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { SchoolStructureController } from './school-structure.controller';
import { SchoolStructureRepository } from './school-structure.repository';
import { SchoolStructureService } from './school-structure.service';

@Module({
  imports: [RiskProfileModule],
  controllers: [SchoolStructureController],
  providers: [SchoolStructureRepository, SchoolStructureService],
  // The teacher link reads the same classroom history through this repository, so
  // both surfaces answer with one implementation.
  exports: [SchoolStructureService, SchoolStructureRepository],
})
export class SchoolStructureModule {}
