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
] as const;

export type PiiReasonCode = (typeof PII_REASON_CODES)[number];

/** Reason codes that require a free-text note (enforced in DTO + service). */
export const PII_REASON_REQUIRES_NOTE: PiiReasonCode[] = ['OTHER'];

/**
 * Mask a PII value for transport: replace letters/digits (incl. Thai) with a mask
 * glyph while keeping separators so the field still reads as an ID/document.
 */
export function maskPiiValue(value: unknown): string {
  const text = toPiiText(value);
  return text.replace(/[\p{L}\p{N}]/gu, '•');
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
