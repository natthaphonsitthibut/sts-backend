import { registerAs } from '@nestjs/config';

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface AuthRuntimeConfig {
  /** Secret for signing the admin session JWT (httpOnly cookie). */
  jwtSecret: string;
  /** Secret for the magic-link / virtual-student signed tokens (HMAC). */
  sessionSecret: string;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  tokenTtlSeconds: number;
  thaidMode: string;
}

/**
 * Required secret — no fallback on purpose. A missing/weak signing secret means
 * anyone can forge a session, so the app must fail to start rather than run with
 * a guessable default.
 */
function requireSecret(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 16) {
    throw new Error(
      `[config] ${name} must be set and at least 16 characters (no insecure default).`,
    );
  }
  return trimmed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSameSite(value: string | undefined): CookieSameSite {
  const normalized = (value || 'lax').trim().toLowerCase();
  return normalized === 'strict' || normalized === 'none' ? normalized : 'lax';
}

export function getAuthConfigFromEnv(): AuthRuntimeConfig {
  return {
    jwtSecret: requireSecret('JWT_SECRET', process.env.JWT_SECRET),
    sessionSecret: requireSecret('AUTH_SESSION_SECRET', process.env.AUTH_SESSION_SECRET),
    cookieName: process.env.AUTH_COOKIE_NAME?.trim() || 'sts_session',
    cookieSecure: (process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase() === 'true',
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE),
    tokenTtlSeconds: parsePositiveInt(process.env.AUTH_TOKEN_TTL_SECONDS, 60 * 60 * 12),
    thaidMode: (process.env.THAID_MODE || 'mock').trim().toLowerCase(),
  };
}

export const authConfig = registerAs('auth', () => getAuthConfigFromEnv());
