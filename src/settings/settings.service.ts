import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import { AutomationService } from '../automation/automation.service';
import {
  findSystemSettingCatalogEntry,
  normalizeSystemSettingValue,
  validateSystemSettingValue,
  type SystemSettingCatalogEntry,
} from './settings-catalog';
import { SettingsRepository } from './settings.repository';
import type { SystemSettingResponse, SystemSettingRow } from './settings.types';

const CRON_REFRESH_KEYS = new Set(['ALERT_TRIGGER_TYPE', 'ALERT_SCHEDULE_TIME']);

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly automationService: AutomationService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Values written before catalog validation existed (or edited directly in
   * the database) can be invalid; surface them at startup instead of letting
   * consumers silently skip work at runtime.
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.settingsRepository.listSettings();
      for (const row of rows) {
        const entry = findSystemSettingCatalogEntry(row.setting_key);
        if (!entry) {
          this.logger.warn(
            `System setting "${row.setting_key}" is not in the settings catalog and cannot be edited via the API.`,
          );
          continue;
        }
        const error = validateSystemSettingValue(entry, row.setting_value);
        if (error) {
          this.logger.warn(
            `System setting "${row.setting_key}" has invalid value "${row.setting_value}": ${error}`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Skipping system settings startup validation: ${message}`);
    }
  }

  private toResponse(row: SystemSettingRow): SystemSettingResponse {
    const entry = findSystemSettingCatalogEntry(row.setting_key);
    return {
      ...row,
      description: entry?.description ?? row.description,
      value_type: entry?.valueType ?? null,
      enum_options: entry?.enumOptions ?? null,
      min: entry?.min ?? null,
      max: entry?.max ?? null,
      editable: entry !== null,
    };
  }

  async getSettings(): Promise<SystemSettingResponse[]> {
    const rows = await this.settingsRepository.listSettings();
    return rows.map((row) => this.toResponse(row));
  }

  async getSettingByKey(key: string): Promise<SystemSettingResponse | null> {
    const row = await this.settingsRepository.findSettingByKey(key);
    return row ? this.toResponse(row) : null;
  }

  private resolveCatalogEntry(key: string): SystemSettingCatalogEntry {
    const entry = findSystemSettingCatalogEntry(key);
    if (!entry) {
      throw new NotFoundException('ไม่รู้จักการตั้งค่านี้');
    }
    return entry;
  }

  async updateSetting(actor: AuthenticatedRequestUser, key: string, value: string) {
    const entry = this.resolveCatalogEntry(key);
    const normalizedValue = normalizeSystemSettingValue(value);
    const validationError = validateSystemSettingValue(entry, normalizedValue);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    const actorId = resolveAuditActorId(actor);
    const { setting, changed } = await this.settingsRepository.withTransaction(
      async (queryRunner) => {
        const existing = await this.settingsRepository.findSettingByKey(key, queryRunner);
        const previousValue = existing?.setting_value ?? null;
        const row = await this.settingsRepository.upsertSetting(
          key,
          normalizedValue,
          entry.description,
          queryRunner,
        );
        const valueChanged = previousValue !== normalizedValue;
        if (valueChanged) {
          await this.auditLog.recordAtomic(
            {
              actorUserId: actorId,
              actorLabel: actor.username,
              action: 'SYSTEM_SETTING_EDIT',
              targetType: 'system_settings',
              targetId: key,
              metadata: {
                op: 'update',
                previousValue,
                newValue: normalizedValue,
              },
              ip: null,
            },
            queryRunner,
          );
        }
        return { setting: row, changed: valueChanged };
      },
    );

    if (changed && CRON_REFRESH_KEYS.has(key)) {
      this.logger.log(`Setting ${key} changed. Triggering dynamic cron refresh.`);
      await this.automationService.refreshDynamicCron();
    }

    return { success: true, data: this.toResponse(setting) };
  }
}
