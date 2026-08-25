import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { SubjectsController } from './subjects.controller';
import { SubjectsRepository } from './subjects.repository';
import { SubjectsService } from './subjects.service';

@Module({
  imports: [AuditLogModule, SchoolStructureModule],
  controllers: [SubjectsController],
  providers: [SubjectsRepository, SubjectsService],
  exports: [SubjectsRepository],
})
export class SubjectsModule {}
