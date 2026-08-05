import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import type { SettingsRepository } from './settings.repository';
import type { AutomationService } from '../automation/automation.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedRequestUser } from '../auth/auth.types';
import type { SystemSettingRow } from './settings.types';

const STORED_VALUES: Record<string, string> = {
  CASE_RISK_HIGH_ABSENCE_DAYS: '3',
  CASE_SLA_HIGH_DAYS: '3',
  ALERT_TRIGGER_TYPE: 'SCHEDULED',
  ALERT_SCHEDULE_TIME: '18:00',
};

describe('SettingsService catalog validation', () => {
  const actor = {
    id: 7,
    username: 'admin-settings',
    virtual_login: false,
  } as unknown as AuthenticatedRequestUser;

  let settingsRepository: {
    listSettings: jest.Mock;
    findSettingByKey: jest.Mock;
    upsertSetting: jest.Mock;
    withTransaction: jest.Mock;
  };
  let automationService: { refreshDynamicCron: jest.Mock };
  let auditLog: { recordAtomic: jest.Mock };
  let riskProfileService: { enqueueFull: jest.Mock };
  let service: SettingsService;

  const buildRow = (overrides: Partial<SystemSettingRow> = {}): SystemSettingRow => ({
    setting_key: 'CASE_RISK_HIGH_ABSENCE_DAYS',
    setting_value: '3',
    description: 'จำนวนวันขาดเรียนสะสมที่ระบบเปิดเคสอัตโนมัติ',
    updated_at: null,
    ...overrides,
  });

  beforeEach(() => {
    settingsRepository = {
      listSettings: jest.fn().mockResolvedValue([]),
      findSettingByKey: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(buildRow({ setting_key: key, setting_value: STORED_VALUES[key] ?? '3' })),
        ),
      upsertSetting: jest
        .fn()
        .mockImplementation((key: string, value: string) =>
          Promise.resolve(buildRow({ setting_key: key, setting_value: value })),
        ),
      withTransaction: jest
        .fn()
        .mockImplementation(
          async (operation: (queryRunner: unknown) => Promise<unknown>): Promise<unknown> => {
            return await operation({ query: jest.fn().mockResolvedValue([]) });
          },
        ),
    };
    automationService = { refreshDynamicCron: jest.fn().mockResolvedValue(undefined) };
    auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    riskProfileService = { enqueueFull: jest.fn().mockResolvedValue(undefined) };
    service = new SettingsService(
      settingsRepository as unknown as SettingsRepository,
      automationService as unknown as AutomationService,
      auditLog as unknown as AuditLogService,
      riskProfileService as never,
    );
  });

  it('rejects a key that is not in the catalog without touching the database', async () => {
    await expect(service.updateSetting(actor, 'UNKNOWN_KEY', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(settingsRepository.withTransaction).not.toHaveBeenCalled();
    expect(settingsRepository.upsertSetting).not.toHaveBeenCalled();
  });

  it('rejects the retired ABSENT_THRESHOLD_DAYS key after the rename', async () => {
    await expect(service.updateSetting(actor, 'ABSENT_THRESHOLD_DAYS', '3')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['CASE_RISK_HIGH_ABSENCE_DAYS', 'abc'],
    ['CASE_RISK_HIGH_ABSENCE_DAYS', '0'],
    ['CASE_RISK_HIGH_ABSENCE_DAYS', '9999'],
    ['ALERT_SCHEDULE_TIME', '99:99'],
    ['ALERT_SCHEDULE_TIME', '18.00'],
    ['ALERT_TRIGGER_TYPE', 'SOMETIMES'],
  ])('rejects invalid value for %s = "%s"', async (key, value) => {
    await expect(service.updateSetting(actor, key, value)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(settingsRepository.upsertSetting).not.toHaveBeenCalled();
    expect(auditLog.recordAtomic).not.toHaveBeenCalled();
  });

  it('persists a valid change with an atomic audit record', async () => {
    const result = await service.updateSetting(actor, 'CASE_RISK_HIGH_ABSENCE_DAYS', '5');

    expect(settingsRepository.upsertSetting).toHaveBeenCalledWith(
      'CASE_RISK_HIGH_ABSENCE_DAYS',
      '5',
      expect.any(String),
      expect.anything(),
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 7,
        action: 'SYSTEM_SETTING_EDIT',
        targetId: 'CASE_RISK_HIGH_ABSENCE_DAYS',
      }),
      expect.anything(),
    );
    const auditCalls = auditLog.recordAtomic.mock.calls as unknown[][];
    const auditInput = auditCalls[0][0] as { metadata: Record<string, unknown> };
    expect(auditInput.metadata).toMatchObject({ previousValue: '3', newValue: '5' });
    expect(result.success).toBe(true);
    expect(result.data.setting_value).toBe('5');
    expect(result.data.value_type).toBe('integer');
    expect(automationService.refreshDynamicCron).not.toHaveBeenCalled();
    expect(riskProfileService.enqueueFull).toHaveBeenCalledWith(
      'setting-change:CASE_RISK_HIGH_ABSENCE_DAYS',
    );
  });

  it('skips the audit record when the value is unchanged', async () => {
    await service.updateSetting(actor, 'CASE_RISK_HIGH_ABSENCE_DAYS', '3');

    expect(auditLog.recordAtomic).not.toHaveBeenCalled();
    expect(automationService.refreshDynamicCron).not.toHaveBeenCalled();
    expect(riskProfileService.enqueueFull).not.toHaveBeenCalled();
  });

  it('refreshes the dynamic cron when an alert setting changes', async () => {
    await service.updateSetting(actor, 'ALERT_SCHEDULE_TIME', '07:30');

    expect(automationService.refreshDynamicCron).toHaveBeenCalledTimes(1);
  });

  it('ignores the client-supplied description and uses the catalog description', async () => {
    await service.updateSetting(actor, 'ALERT_TRIGGER_TYPE', 'IMMEDIATE');

    const upsertCalls = settingsRepository.upsertSetting.mock.calls as unknown[][];
    const description = upsertCalls[0][2] as string;
    expect(description).toContain('ตัวตรวจขาดเรียนอัตโนมัติ');
  });

  it('enriches settings with catalog metadata and marks unknown rows read-only', async () => {
    settingsRepository.listSettings.mockResolvedValue([
      buildRow(),
      buildRow({ setting_key: 'LEGACY_KEY', setting_value: 'x', description: 'legacy' }),
    ]);

    const rows = await service.getSettings();

    expect(rows[0].editable).toBe(true);
    expect(rows[0].value_type).toBe('integer');
    expect(rows[0].min).toBe(1);
    expect(rows[0].group).toBeTruthy();
    expect(rows[1].editable).toBe(false);
    expect(rows[1].value_type).toBeNull();
    expect(rows[1].group).toBeNull();
  });

  it('returns settings in catalog order with unknown keys last', async () => {
    settingsRepository.listSettings.mockResolvedValue([
      buildRow({ setting_key: 'ALERT_SCHEDULE_TIME', setting_value: '18:00' }),
      buildRow({ setting_key: 'LEGACY_KEY', setting_value: 'x' }),
      buildRow({ setting_key: 'CASE_SLA_HIGH_DAYS', setting_value: '3' }),
      buildRow(),
    ]);

    const rows = await service.getSettings();

    expect(rows.map((row) => row.setting_key)).toEqual([
      'CASE_RISK_HIGH_ABSENCE_DAYS',
      'CASE_SLA_HIGH_DAYS',
      'ALERT_SCHEDULE_TIME',
      'LEGACY_KEY',
    ]);
  });
});
