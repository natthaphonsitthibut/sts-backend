import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TimetableRepository } from './timetable.repository';
import { TimetableService } from './timetable.service';

@Module({
  imports: [AuditLogModule],
  // Historical readers still use TimetableService; all timetable HTTP routes
  // are retired by the attendance simplification.
  controllers: [],
  providers: [TimetableRepository, TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
