import { Injectable, OnModuleInit } from '@nestjs/common';
import { AbsenceMonitorService } from './absence-monitor.service';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { SubjectRiskMonitorService } from './subject-risk-monitor.service';
export type { NewCase } from './automation.types';

@Injectable()
export class AutomationService implements OnModuleInit {
  constructor(
    private readonly automationSchedulerService: AutomationSchedulerService,
    private readonly absenceMonitorService: AbsenceMonitorService,
    private readonly subjectRiskMonitorService: SubjectRiskMonitorService,
  ) {}

  async onModuleInit() {
    await this.refreshDynamicCron();
  }

  async refreshDynamicCron() {
    await this.automationSchedulerService.refreshDynamicCron();
  }

  async checkConsecutiveAbsences() {
    return await this.absenceMonitorService.checkConsecutiveAbsences();
  }

  async checkSubjectRiskSignals() {
    return await this.subjectRiskMonitorService.checkSubjectRiskSignals();
  }
}
