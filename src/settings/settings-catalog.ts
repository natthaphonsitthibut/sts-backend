export type SystemSettingValueType = 'integer' | 'time' | 'enum';

export interface SystemSettingEnumOption {
  value: string;
  label: string;
}

export interface SystemSettingCatalogEntry {
  key: string;
  valueType: SystemSettingValueType;
  defaultValue: string;
  description: string;
  enumOptions?: SystemSettingEnumOption[];
  min?: number;
  max?: number;
}

/**
 * Single source of truth for every system setting the API accepts. Keys not
 * listed here cannot be created or updated through the settings endpoint, and
 * values are validated against the entry before they reach the database.
 */
export const SYSTEM_SETTING_CATALOG: SystemSettingCatalogEntry[] = [
  {
    key: 'ABSENT_THRESHOLD_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    description: 'จำนวนวันขาดเรียนติดต่อกันก่อนที่จะแจ้งเตือนหรือเปิดเคสอัตโนมัติ',
  },
  {
    key: 'ALERT_TRIGGER_TYPE',
    valueType: 'enum',
    defaultValue: 'SCHEDULED',
    enumOptions: [
      { value: 'SCHEDULED', label: 'ตามตารางกะเวลา' },
      { value: 'IMMEDIATE', label: 'แจ้งเตือนทันที' },
    ],
    description: 'รูปแบบการทำงาน (SCHEDULED = ตามตารางกะเวลา, IMMEDIATE = แจ้งเตือนทันที)',
  },
  {
    key: 'ALERT_SCHEDULE_TIME',
    valueType: 'time',
    defaultValue: '18:00',
    description: 'เวลาที่จะรันบอทตรวจสอบข้อมูล (HH:MM) เมื่อเลือกรูปแบบ SCHEDULED',
  },
];

const CATALOG_BY_KEY = new Map(SYSTEM_SETTING_CATALOG.map((entry) => [entry.key, entry]));

export function findSystemSettingCatalogEntry(key: string): SystemSettingCatalogEntry | null {
  return CATALOG_BY_KEY.get(key) ?? null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Returns a Thai error message when the value is invalid for the entry, or
 * null when the value is acceptable.
 */
export function validateSystemSettingValue(
  entry: SystemSettingCatalogEntry,
  rawValue: string,
): string | null {
  const value = rawValue.trim();
  if (value.length === 0) {
    return 'ค่าการตั้งค่าต้องไม่ว่าง';
  }

  switch (entry.valueType) {
    case 'integer': {
      if (!/^-?\d+$/.test(value)) {
        return 'ค่าต้องเป็นจำนวนเต็ม';
      }
      const parsed = Number(value);
      if (entry.min !== undefined && parsed < entry.min) {
        return `ค่าต้องไม่น้อยกว่า ${entry.min}`;
      }
      if (entry.max !== undefined && parsed > entry.max) {
        return `ค่าต้องไม่เกิน ${entry.max}`;
      }
      return null;
    }
    case 'time': {
      if (!TIME_PATTERN.test(value)) {
        return 'ค่าต้องเป็นเวลารูปแบบ HH:MM เช่น 18:00';
      }
      return null;
    }
    case 'enum': {
      const allowed = (entry.enumOptions ?? []).map((option) => option.value);
      if (!allowed.includes(value)) {
        return `ค่าต้องเป็นหนึ่งใน: ${allowed.join(', ')}`;
      }
      return null;
    }
    default:
      return 'ไม่รู้จักชนิดของการตั้งค่านี้';
  }
}

export function normalizeSystemSettingValue(rawValue: string): string {
  return rawValue.trim();
}
