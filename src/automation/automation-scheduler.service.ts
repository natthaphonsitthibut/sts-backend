import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { AbsenceMonitorService } from './absence-monitor.service';
import { AutomationRepository } from './automation.repository';
import { SubjectRiskMonitorService } from './subject-risk-monitor.service';

// ALERT_SCHEDULE_TIME is wall-clock time for Thai schools; pin the cron to
// Asia/Bangkok so it does not drift with the server's local timezone (e.g. UTC).
const SCHEDULER_TIMEZONE = BANGKOK_TIME_ZONE;

@Injectable()
export class AutomationSchedulerService {
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private readonly absenceJobName = 'check_consecutive_absences_job';

  constructor(
    private readonly automationRepository: AutomationRepository,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly absenceMonitorService: AbsenceMonitorService,
    private readonly subjectRiskMonitorService: SubjectRiskMonitorService,
  ) {}

  private async runScheduledAbsenceCheck(cronTime: string): Promise<void> {
    this.logger.log(`Executing Scheduled Job: ${cronTime}`);
    await this.absenceMonitorService.checkConsecutiveAbsences();
    await this.subjectRiskMonitorService.checkSubjectRiskSignals();
  }

  async refreshDynamicCron(): Promise<void> {
    const triggerType =
      (await this.automationRepository.getSystemSettingValue('ALERT_TRIGGER_TYPE')) ?? 'SCHEDULED';
    const scheduleTime =
      (await this.automationRepository.getSystemSettingValue('ALERT_SCHEDULE_TIME')) ?? '18:00';

    if (this.schedulerRegistry.doesExist('cron', this.absenceJobName)) {
      this.schedulerRegistry.deleteCronJob(this.absenceJobName);
      this.logger.log(`Deleted existing CronJob: ${this.absenceJobName}`);
    }

    if (triggerType === 'IMMEDIATE') {
      this.logger.log('Alert Trigger Type is IMMEDIATE. Skipping Cron registration.');
      return;
    }

    const fallbackTime = '18:00';
    const timeParts = scheduleTime.split(':');
    if (timeParts.length !== 2) {
      this.logger.error(
        `Invalid ALERT_SCHEDULE_TIME format: ${scheduleTime}. Expected HH:MM. Using fallback ${fallbackTime}.`,
      );
      timeParts[0] = '18';
      timeParts[1] = '00';
    }

    const hour = Number.parseInt(timeParts[0], 10);
    const minute = Number.parseInt(timeParts[1], 10);
    const validHour = Number.isInteger(hour) && hour >= 0 && hour <= 23;
    const validMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59;

    const finalHour = validHour ? hour : 18;
    const finalMinute = validMinute ? minute : 0;
    const cronTime = `0 ${finalMinute} ${finalHour} * * *`;

    const job = CronJob.from({
      cronTime,
      timeZone: SCHEDULER_TIMEZONE,
      onTick: () => {
        void this.runScheduledAbsenceCheck(cronTime);
      },
    });

    this.schedulerRegistry.addCronJob(this.absenceJobName, job);
    job.start();

    this.logger.log(
      `Registered Dynamic CronJob [${this.absenceJobName}] to run at ${cronTime} (${SCHEDULER_TIMEZONE})`,
    );
  }
}
