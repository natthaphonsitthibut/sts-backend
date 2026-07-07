import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SubjectsController } from './subjects.controller';
import { SubjectsRepository } from './subjects.repository';
import { SubjectsService } from './subjects.service';

@Module({
  imports: [AuditLogModule],
  controllers: [SubjectsController],
  providers: [SubjectsRepository, SubjectsService],
  exports: [SubjectsRepository],
})
export class SubjectsModule {}
