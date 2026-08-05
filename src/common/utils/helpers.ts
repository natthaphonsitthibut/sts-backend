import * as crypto from 'crypto';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function maskName(name: string): string {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const prefix = parts[0];
    const firstName = parts[1];
    const masked = firstName.length > 2 ? firstName.slice(0, 2) + '****' : firstName + '****';
    return prefix + ' ' + masked;
  }
  if (name.length <= 2) return name;
  return name.slice(0, 2) + '****';
}

/** Escape LIKE/ILIKE wildcards so user input matches literally (pair with ESCAPE '\\'). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (wildcard) => `\\${wildcard}`);
}

export function sanitize(str: string): string {
  if (!str) return str;
  return String(str).replace(
    /[<>"'&]/g,
    (c) =>
      (
        ({
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
          '&': '&amp;',
        }) as Record<string, string>
      )[c],
  );
}

export function clean(str: any): string | null {
  if (!str) return null;
  const s = String(str).trim();
  return s ? sanitize(s) : null;
}
