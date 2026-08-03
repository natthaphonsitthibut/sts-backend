import { Module } from '@nestjs/common';
import { CurriculumController } from './curriculum.controller';
import { CurriculumRepository } from './curriculum.repository';
import { CurriculumService } from './curriculum.service';

// AuditLogModule and FileStorageModule are both @Global, so neither is imported
// here — same as SchoolStructureModule and TeachersModule.
@Module({
  controllers: [CurriculumController],
  providers: [CurriculumRepository, CurriculumService],
  exports: [CurriculumRepository],
})
export class CurriculumModule {}
