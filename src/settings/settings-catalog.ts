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
  group: string;
  enumOptions?: SystemSettingEnumOption[];
  min?: number;
  max?: number;
}

/**
 * Single source of truth for every system setting the API accepts. Keys not
 * listed here cannot be created or updated through the settings endpoint, and
 * values are validated against the entry before they reach the database.
 */
const GROUP_CASE_RISK = 'เกณฑ์เปิดเคสและระดับความเสี่ยง';
const GROUP_CASE_SLA = 'กำหนดเวลาดำเนินการเคส (SLA)';
const GROUP_ABSENCE_MONITOR = 'รอบการตรวจขาดเรียนอัตโนมัติ';

export const SYSTEM_SETTING_CATALOG: SystemSettingCatalogEntry[] = [
  {
    key: 'CASE_RISK_HIGH_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_CASE_RISK,
    description:
      'จำนวนวันขาดเรียนหลังปิดเคสล่าสุด (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น',
  },
  {
    key: 'CASE_SLA_HIGH_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_CASE_SLA,
    description:
      'เคสที่เปิดอัตโนมัติต้องมีการดำเนินการครั้งแรกภายในกี่วันปฏิทินนับจากวันเปิดเคส (ระบบแจ้งเตือนเมื่อใช้เวลาไปแล้ว 80%)',
  },
  {
    key: 'ALERT_TRIGGER_TYPE',
    valueType: 'enum',
    defaultValue: 'SCHEDULED',
    group: GROUP_ABSENCE_MONITOR,
    enumOptions: [
      { value: 'SCHEDULED', label: 'ตามเวลาที่กำหนด' },
      { value: 'IMMEDIATE', label: 'ทันทีหลังบันทึกเช็กชื่อ' },
    ],
    description:
      'จังหวะรันตัวตรวจขาดเรียนอัตโนมัติ (SCHEDULED = รันวันละครั้งตามเวลาที่กำหนด, IMMEDIATE = รันทันทีทุกครั้งหลังบันทึกเช็กชื่อ)',
  },
  {
    key: 'ALERT_SCHEDULE_TIME',
    valueType: 'time',
    defaultValue: '18:00',
    group: GROUP_ABSENCE_MONITOR,
    description:
      'เวลารันตัวตรวจขาดเรียนอัตโนมัติประจำวัน (HH:MM) — ใช้เมื่อจังหวะรันเป็น SCHEDULED',
  },
];

const CATALOG_ORDER_BY_KEY = new Map(
  SYSTEM_SETTING_CATALOG.map((entry, index) => [entry.key, index]),
);

/** Sort position for display: catalog order first, unknown keys last (alphabetical). */
export function getSystemSettingSortIndex(key: string): number {
  return CATALOG_ORDER_BY_KEY.get(key) ?? Number.MAX_SAFE_INTEGER;
}

interface OrderedSettingLadder {
  /** Keys in ascending-value order; values must satisfy v[0] <= v[1] <= v[2]. */
  keys: readonly string[];
  labels: readonly string[];
  buildError: (parts: string[]) => string;
}

// No ordered ladder remains: the tier ladder collapsed to a single absence
// threshold. The guard below stays so a future ladder can be declared here.
const ORDERED_SETTING_LADDERS: readonly OrderedSettingLadder[] = [];

/**
 * Cross-field guard for settings that form an ordered ladder. Returns a Thai
 * error message when saving `key` = `newValue` would break the ordering, or
 * null when consistent. `resolveValue` supplies the current stored value of a
 * sibling key (catalog default is used when a sibling row is missing).
 */
export async function validateSystemSettingLadder(
  key: string,
  newValue: string,
  resolveValue: (siblingKey: string) => Promise<string | null>,
): Promise<string | null> {
  const ladder = ORDERED_SETTING_LADDERS.find((candidate) => candidate.keys.includes(key));
  if (!ladder) {
    return null;
  }

  const values: number[] = [];
  for (const ladderKey of ladder.keys) {
    const raw =
      ladderKey === key
        ? newValue
        : ((await resolveValue(ladderKey)) ??
          findSystemSettingCatalogEntry(ladderKey)?.defaultValue ??
          null);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed)) {
      // A sibling holds an invalid value (flagged at startup); don't block this save.
      return null;
    }
    values.push(parsed);
  }

  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > values[i]) {
      const parts = values.map((value, index) => `${ladder.labels[index]} (${value} วัน)`);
      return ladder.buildError(parts);
    }
  }
  return null;
}

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
