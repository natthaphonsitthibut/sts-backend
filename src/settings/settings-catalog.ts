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
const GROUP_CASE_RISK = 'เกณฑ์เปิดเคสและระดับความเสี่ยง (นับวันเรียนที่ขาดติดต่อกัน)';
const GROUP_SUBJECT_RISK = 'เกณฑ์ความเสี่ยงจากเช็คชื่อรายวิชา';
const GROUP_CASE_SLA = 'กำหนดเวลาดำเนินการเคส (SLA)';
const GROUP_ABSENCE_MONITOR = 'รอบการตรวจขาดเรียนอัตโนมัติ';

export const SYSTEM_SETTING_CATALOG: SystemSettingCatalogEntry[] = [
  {
    key: 'CASE_RISK_LOW_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_CASE_RISK,
    description:
      'จำนวนวันขาดเรียนติดต่อกันที่ระบบเปิดเคสอัตโนมัติ โดยเริ่มที่ระดับความเสี่ยงต่ำ (ขั้นแรกของบันไดความเสี่ยงต่ำ → ปานกลาง → สูง)',
  },
  {
    key: 'CASE_RISK_MEDIUM_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '5',
    min: 1,
    max: 365,
    group: GROUP_CASE_RISK,
    description:
      'จำนวนวันขาดเรียนติดต่อกันที่จัดเป็นความเสี่ยงปานกลาง — เคสที่เปิดอยู่จะถูกปรับระดับขึ้นอัตโนมัติเมื่อขาดถึงเกณฑ์นี้',
  },
  {
    key: 'CASE_RISK_HIGH_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '7',
    min: 1,
    max: 365,
    group: GROUP_CASE_RISK,
    description:
      'จำนวนวันขาดเรียนติดต่อกันที่จัดเป็นความเสี่ยงสูง — เคสที่เปิดอยู่จะถูกปรับระดับขึ้นอัตโนมัติเมื่อขาดถึงเกณฑ์นี้',
  },
  {
    key: 'SUBJECT_RISK_MIXED_ABSENCE_WINDOW_DAYS',
    valueType: 'integer',
    defaultValue: '7',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'ช่วงวันย้อนหลังสำหรับตรวจโดดคาบแบบมาเรียนบางคาบและขาดบางคาบในวันเดียวกัน',
  },
  {
    key: 'SUBJECT_RISK_MIXED_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'จำนวนวันที่พบการมาเรียนบางคาบแต่ขาดบางคาบในช่วงที่กำหนด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_WINDOW_DAYS',
    valueType: 'integer',
    defaultValue: '30',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'ช่วงวันย้อนหลังสำหรับตรวจรูปแบบเลี่ยงวิชาเดิม',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_CONSECUTIVE_PERIODS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'จำนวนคาบติดกันของวิชาเดียวกันที่ขาด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_ABSENT_PERCENT',
    valueType: 'integer',
    defaultValue: '30',
    min: 1,
    max: 100,
    group: GROUP_SUBJECT_RISK,
    description: 'เปอร์เซ็นต์คาบที่ขาดในวิชาเดียวกันภายในช่วงที่กำหนด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_LATE_WINDOW_DAYS',
    valueType: 'integer',
    defaultValue: '30',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'ช่วงวันย้อนหลังสำหรับตรวจการมาสายจากเช็คชื่อรายวิชา',
  },
  {
    key: 'SUBJECT_RISK_LATE_WATCH_COUNT',
    valueType: 'integer',
    defaultValue: '5',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'จำนวนครั้งที่มาสายในช่วงที่กำหนด ก่อนแจ้งเตือนเฝ้าระวังโดยไม่เปิดเคส',
  },
  {
    key: 'CASE_RISK_TERM_ABSENCE_DAYS',
    valueType: 'integer',
    defaultValue: '7',
    min: 1,
    max: 365,
    group: GROUP_SUBJECT_RISK,
    description: 'จำนวนวันขาดสะสมต่อเทอมที่เปิดเคสระดับปานกลาง',
  },
  {
    key: 'CASE_RISK_HIGH_ATTENDANCE_PERCENT',
    valueType: 'integer',
    defaultValue: '80',
    min: 1,
    max: 100,
    group: GROUP_SUBJECT_RISK,
    description: 'เปอร์เซ็นต์เวลาเรียนต่ำกว่าเกณฑ์นี้ให้เปิดเคสระดับสูง',
  },
  {
    key: 'CASE_SLA_HIGH_DAYS',
    valueType: 'integer',
    defaultValue: '3',
    min: 1,
    max: 365,
    group: GROUP_CASE_SLA,
    description:
      'เคสความเสี่ยงสูงต้องมีการดำเนินการครั้งแรกภายในกี่วันปฏิทินนับจากวันเปิดเคส (ระบบแจ้งเตือนเมื่อใช้เวลาไปแล้ว 80%)',
  },
  {
    key: 'CASE_SLA_MEDIUM_DAYS',
    valueType: 'integer',
    defaultValue: '7',
    min: 1,
    max: 365,
    group: GROUP_CASE_SLA,
    description:
      'เคสความเสี่ยงปานกลางต้องมีการดำเนินการครั้งแรกภายในกี่วันปฏิทินนับจากวันเปิดเคส (ระบบแจ้งเตือนเมื่อใช้เวลาไปแล้ว 80%)',
  },
  {
    key: 'CASE_SLA_LOW_DAYS',
    valueType: 'integer',
    defaultValue: '14',
    min: 1,
    max: 365,
    group: GROUP_CASE_SLA,
    description:
      'เคสความเสี่ยงต่ำต้องมีการดำเนินการครั้งแรกภายในกี่วันปฏิทินนับจากวันเปิดเคส (ระบบแจ้งเตือนเมื่อใช้เวลาไปแล้ว 80%)',
  },
  {
    key: 'ALERT_TRIGGER_TYPE',
    valueType: 'enum',
    defaultValue: 'SCHEDULED',
    group: GROUP_ABSENCE_MONITOR,
    enumOptions: [
      { value: 'SCHEDULED', label: 'ตามเวลาที่กำหนด' },
      { value: 'IMMEDIATE', label: 'ทันทีหลังบันทึกเช็คชื่อ' },
    ],
    description:
      'จังหวะรันตัวตรวจขาดเรียนอัตโนมัติ (SCHEDULED = รันวันละครั้งตามเวลาที่กำหนด, IMMEDIATE = รันทันทีทุกครั้งหลังบันทึกเช็คชื่อ)',
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

const ORDERED_SETTING_LADDERS: readonly OrderedSettingLadder[] = [
  {
    keys: [
      'CASE_RISK_LOW_ABSENCE_DAYS',
      'CASE_RISK_MEDIUM_ABSENCE_DAYS',
      'CASE_RISK_HIGH_ABSENCE_DAYS',
    ],
    labels: ['ความเสี่ยงต่ำ', 'ความเสี่ยงปานกลาง', 'ความเสี่ยงสูง'],
    buildError: (parts) =>
      `เกณฑ์วันขาดเรียนต้องเรียงจากน้อยไปมากตามระดับความเสี่ยง: ${parts.join(' ≤ ')}`,
  },
  {
    keys: ['CASE_SLA_HIGH_DAYS', 'CASE_SLA_MEDIUM_DAYS', 'CASE_SLA_LOW_DAYS'],
    labels: ['ความเสี่ยงสูง', 'ความเสี่ยงปานกลาง', 'ความเสี่ยงต่ำ'],
    buildError: (parts) =>
      `เคสที่เสี่ยงกว่าต้องได้เวลาดำเนินการไม่มากกว่าเคสที่เสี่ยงน้อยกว่า: ${parts.join(' ≤ ')}`,
  },
];

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
