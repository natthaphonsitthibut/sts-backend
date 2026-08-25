import { createHmac } from 'crypto';

/**
 * Build the pseudonymous student reference stored in `pii_access_events`. Uses a
 * keyed HMAC (server-side pepper) rather than a plain hash, because the national
 * id is low-entropy and a plain hash could be brute-forced from a stolen log. The
 * same (personId, pepper, keyVersion) always yields the same ref, so "who viewed
 * student X" stays queryable without ever storing the raw id.
 */
export function buildSubjectStudentRef(
  personId: string,
  pepper: string,
  keyVersion: number,
): string {
  // Canonicalize so the same person always maps to the same ref regardless of
  // separators/case in the incoming id (e.g. "7-9379-25157-59-4" vs digits-only).
  const canonical = personId.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const digest = createHmac('sha256', pepper).update(`v${keyVersion}:${canonical}`).digest('hex');
  return `v${keyVersion}$${digest}`;
}

/** Generic alias for non-student PII subjects that use the same HMAC format. */
export const buildPiiSubjectRef = buildSubjectStudentRef;
