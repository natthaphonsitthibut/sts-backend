/**
 * Encode a non-sensitive row timestamp for a guarded media URL cache key.
 * Storage object names must never be used as public version tokens.
 */
export function encodeMediaVersion(value: unknown): string {
  if (value instanceof Date) return encodeURIComponent(value.toISOString());
  if (typeof value === 'string') return encodeURIComponent(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return encodeURIComponent(String(value));
  }
  return '';
}
