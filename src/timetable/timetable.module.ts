import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TimetableController } from './timetable.controller';
import { TimetableRepository } from './timetable.repository';
import { TimetableService } from './timetable.service';

@Module({
  imports: [AuditLogModule],
  controllers: [TimetableController],
  providers: [TimetableRepository, TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
