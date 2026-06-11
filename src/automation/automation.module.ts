import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AbsenceMonitorService } from './absence-monitor.service';
import { AutomationRepository } from './automation.repository';
import { AutomationSchedulerService } from './automation-scheduler.service';

@Module({
  providers: [
    AutomationService,
    AutomationRepository,
    AbsenceMonitorService,
    AutomationSchedulerService,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
