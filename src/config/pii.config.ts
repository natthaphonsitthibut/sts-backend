import { registerAs } from '@nestjs/config';

export interface PiiRuntimeConfig {
  /** HMAC key for the pseudonymous student reference in the PII access log. */
  hashPepper: string;
  /** Key version stored alongside each ref so the pepper can be rotated later. */
  hashKeyVersion: number;
}

/**
 * Resolve the PII-hash pepper. National ID is low-entropy (13 structured digits),
 * so the access log must key its subject reference with a secret pepper — a plain
 * hash would be brute-forceable from a stolen log. Required in production (no
 * insecure default); in development it falls back to AUTH_SESSION_SECRET so local
 * setup needs no extra env.
 */
function resolvePepper(): string {
  const explicit = process.env.PII_HASH_PEPPER?.trim();
  if (explicit && explicit.length >= 16) {
    return explicit;
  }

  const isProduction =
    (process.env.NODE_ENV || 'development').trim().toLowerCase() === 'production';
  if (isProduction) {
    throw new Error(
      '[config] PII_HASH_PEPPER must be set and at least 16 characters in production (no insecure default).',
    );
  }

  const fallback = process.env.AUTH_SESSION_SECRET?.trim();
  if (fallback && fallback.length >= 16) {
    return fallback;
  }

  throw new Error(
    '[config] PII_HASH_PEPPER (or the AUTH_SESSION_SECRET dev fallback) must be set for PII access logging.',
  );
}

export function getPiiConfigFromEnv(): PiiRuntimeConfig {
  const keyVersion = Number.parseInt(process.env.PII_HASH_KEY_VERSION || '1', 10);
  return {
    hashPepper: resolvePepper(),
    hashKeyVersion: Number.isInteger(keyVersion) && keyVersion > 0 ? keyVersion : 1,
  };
}

export const piiConfig = registerAs('pii', () => getPiiConfigFromEnv());
