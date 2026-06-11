import { Injectable, Logger } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { SettingsRepository } from './settings.repository';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly automationService: AutomationService,
  ) {}

  async getSettings() {
    return await this.settingsRepository.listSettings();
  }

  async getSettingByKey(key: string) {
    return await this.settingsRepository.findSettingByKey(key);
  }

  async updateSetting(key: string, value: string, description?: string) {
    const setting = await this.settingsRepository.upsertSetting(key, String(value), description);

    if (key === 'ALERT_TRIGGER_TYPE' || key === 'ALERT_SCHEDULE_TIME') {
      this.logger.log(`Setting ${key} changed. Triggering dynamic cron refresh.`);
      await this.automationService.refreshDynamicCron();
    }

    return { success: true, data: setting };
  }
}
