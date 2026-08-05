import { Module } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { AbsenceMonitorService } from './absence-monitor.service';
import { AutomationRepository } from './automation.repository';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';

@Module({
  imports: [NotificationsModule, RiskProfileModule],
  providers: [
    AutomationService,
    AutomationRepository,
    AbsenceMonitorService,
    AutomationSchedulerService,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
