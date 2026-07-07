import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TaskModule } from '../task/task.module';
import {
  GuestWorkSessionController,
  WorkSessionMonitorController,
} from './visit-work-sessions.controller';
import { VisitWorkSessionsRepository } from './visit-work-sessions.repository';
import { VisitWorkSessionsService } from './visit-work-sessions.service';

@Module({
  imports: [AuditLogModule, TaskModule],
  controllers: [GuestWorkSessionController, WorkSessionMonitorController],
  providers: [VisitWorkSessionsRepository, VisitWorkSessionsService],
})
export class VisitWorkSessionsModule {}
