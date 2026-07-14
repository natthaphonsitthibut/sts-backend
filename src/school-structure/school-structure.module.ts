import { Module } from '@nestjs/common';
import { SchoolStructureController } from './school-structure.controller';
import { SchoolStructureRepository } from './school-structure.repository';
import { SchoolStructureService } from './school-structure.service';

@Module({
  controllers: [SchoolStructureController],
  providers: [SchoolStructureRepository, SchoolStructureService],
  exports: [SchoolStructureService],
})
export class SchoolStructureModule {}
