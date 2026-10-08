import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private readonly absenceJobName = 'check_consecutive_absences_job';

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  // Retain the refresh entry point for existing callers, but never register a
  // daily absence job: committed check-ins now trigger the scoped monitor.
  refreshDynamicCron(): Promise<void> {
    if (this.schedulerRegistry.doesExist('cron', this.absenceJobName)) {
      this.schedulerRegistry.deleteCronJob(this.absenceJobName);
      this.logger.log('Removed legacy scheduled absence monitor');
    }
    return Promise.resolve();
  }
}
