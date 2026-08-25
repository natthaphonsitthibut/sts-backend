/**
 * Single source of truth for PII field grouping, the Phase-1 masking policy, and
 * reveal reason codes. Keep all PII tier/field/reason decisions here — do not
 * scatter literal field names or reason strings across services/controllers.
 */

/** Sensitive student_term columns grouped by reveal unit. */
export const PII_FIELD_GROUPS = {
  NATIONAL_ID: ['PersonID_Onec'],
  PASSPORT: ['PassportNumber_Onec'],
  // ADDRESS is defined for later phases but intentionally NOT masked in Phase 1:
  // GET /api/students/:id feeds the visit-home form prefill, which legitimately
  // needs the real address (masking it would write "•••" into task/case data).
  ADDRESS: ['VillageNumber_Onec', 'Street_Onec', 'Soi_Onec', 'Trok_Onec'],
} as const;

export type PiiFieldGroup = keyof typeof PII_FIELD_GROUPS;

/** Persisted audit field-group codes, shared by student and managed-user PII flows. */
export const PII_FIELD_GROUP_CODES: Record<PiiFieldGroup, PiiFieldGroup> = {
  NATIONAL_ID: 'NATIONAL_ID',
  PASSPORT: 'PASSPORT',
  ADDRESS: 'ADDRESS',
};

/** Groups masked by default in the student-detail response (Phase 1). */
export const PHASE1_MASKED_GROUPS: PiiFieldGroup[] = ['NATIONAL_ID', 'PASSPORT'];

/** Groups a permitted, in-scope actor may reveal via the reveal endpoint (Phase 1). */
export const REVEALABLE_GROUPS: PiiFieldGroup[] = ['NATIONAL_ID', 'PASSPORT'];

/** Reason codes for a reveal — surfaced in the UI via the central Combobox. */
export const PII_REASON_CODES = [
  'HOME_VISIT',
  'CONTACT_PARENT',
  'VERIFY_DATA',
  'COORDINATE_AGENCY',
  'OTHER',
  // SELF_ACCESS is reserved for data-subject self-reveal and must never be
  // accepted from a non-self actor.
  'SELF_ACCESS',
] as const;

export type PiiReasonCode = (typeof PII_REASON_CODES)[number];

/** User-facing reveal reasons served to every PII dialog from one backend source. */
export const PII_REASON_LABELS: Record<PiiReasonCode, string> = {
  HOME_VISIT: 'เยี่ยมบ้าน/ติดตาม',
  CONTACT_PARENT: 'ติดต่อผู้ปกครอง',
  VERIFY_DATA: 'ตรวจสอบ/แก้ไขข้อมูล',
  COORDINATE_AGENCY: 'ประสานหน่วยงาน',
  OTHER: 'อื่น ๆ (ระบุ)',
  SELF_ACCESS: 'ดูข้อมูลของตนเอง',
};

/** Reason codes that require a free-text note (enforced in DTO + service). */
export const PII_REASON_REQUIRES_NOTE: PiiReasonCode[] = ['OTHER'];

/** SELF_ACCESS is resolved by the server and is never selectable by staff. */
export function listStaffPiiRevealReasons() {
  return PII_REASON_CODES.filter((code) => code !== 'SELF_ACCESS').map((code) => ({
    value: code,
    label: PII_REASON_LABELS[code],
    requiresNote: PII_REASON_REQUIRES_NOTE.includes(code),
  }));
}

/**
 * Fully mask a PII value for transport. Separators are masked too so neither a
 * visible suffix nor the stored document format leaks through the response.
 */
export function maskPiiValue(value: unknown): string {
  const text = toPiiText(value).trim();
  return '•'.repeat(Array.from(text).length);
}

/** Canonical display/transport form for a Thai national id: no separators. */
export function normalizeNationalIdValue(value: unknown): string {
  const text = toPiiText(value).trim();
  const digits = text.replace(/[^0-9]/g, '');
  return digits || text.replace(/[\s-]/g, '');
}

export function maskNationalIdValue(value: unknown): string {
  return maskPiiValue(normalizeNationalIdValue(value));
}

/** True when the value is present (non-empty) and therefore worth masking/revealing. */
export function hasPiiValue(value: unknown): boolean {
  return toPiiText(value).trim().length > 0;
}

/** Coerce a stored PII column (text/number/null) to a string; never stringify objects. */
function toPiiText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return '';
}
