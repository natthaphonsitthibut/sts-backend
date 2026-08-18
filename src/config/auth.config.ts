import { registerAs } from '@nestjs/config';

export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface AuthRuntimeConfig {
  /** Secret for signing the admin session JWT (httpOnly cookie). */
  jwtSecret: string;
  /** Secret for the magic-link signed tokens (HMAC). */
  sessionSecret: string;
  /** Lifetime of an OTP-verified magic session before re-verification is required. */
  magicSessionTtlSeconds: number;
  /** Validity window of a one-time OTP code itself (request → verify). */
  otpTtlSeconds: number;
  /** Failed OTP guesses allowed per link before it is locked (brute-force cap). */
  otpMaxAttempts: number;
  /** How long a link stays locked after hitting the OTP attempt cap. */
  otpLockSeconds: number;
  /** How long an AraID QR stays scannable before anyone claims it. */
  araIdChallengeEntryTtlSeconds: number;
  /** How long the scanning device then has to finish PIN + approval. */
  araIdChallengeAuthorizationTtlSeconds: number;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: CookieSameSite;
  tokenTtlSeconds: number;
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

/**
 * Bounded so a typo cannot leave a QR or an approval window open for hours;
 * an out-of-range value falls back instead of failing the boot.
 */
function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function parseSameSite(value: string | undefined): CookieSameSite {
  const normalized = (value || 'lax').trim().toLowerCase();
  return normalized === 'strict' || normalized === 'none' ? normalized : 'lax';
}

export function getAuthConfigFromEnv(): AuthRuntimeConfig {
  return {
    jwtSecret: requireSecret('JWT_SECRET', process.env.JWT_SECRET),
    sessionSecret: requireSecret('AUTH_SESSION_SECRET', process.env.AUTH_SESSION_SECRET),
    // OTP-verified magic session TTL — default 6h (re-OTP after, capped anyway by
    // the link's own expiry). The instant is checked against the token's `ts`.
    magicSessionTtlSeconds: parsePositiveInt(process.env.MAGIC_SESSION_TTL_SECONDS, 6 * 60 * 60),
    otpTtlSeconds: parsePositiveInt(process.env.OTP_TTL_SECONDS, 10 * 60),
    // Brute-force cap: lock a link after N wrong OTP guesses for a cool-down
    // window. A fresh OTP request resets both (see TaskRepository.updateLinkOtp).
    otpMaxAttempts: parsePositiveInt(process.env.OTP_MAX_ATTEMPTS, 5),
    otpLockSeconds: parsePositiveInt(process.env.OTP_LOCK_SECONDS, 15 * 60),
    cookieName: process.env.AUTH_COOKIE_NAME?.trim() || 'sts_session',
    araIdChallengeEntryTtlSeconds: parseBoundedInt(
      process.env.ARAID_CHALLENGE_ENTRY_TTL_SECONDS,
      90,
      30,
      600,
    ),
    araIdChallengeAuthorizationTtlSeconds: parseBoundedInt(
      process.env.ARAID_CHALLENGE_AUTHORIZATION_TTL_SECONDS,
      10 * 60,
      60,
      30 * 60,
    ),
    cookieSecure: (process.env.AUTH_COOKIE_SECURE || '').trim().toLowerCase() === 'true',
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE),
    tokenTtlSeconds: parsePositiveInt(process.env.AUTH_TOKEN_TTL_SECONDS, 60 * 60 * 12),
  };
}

export const authConfig = registerAs('auth', () => getAuthConfigFromEnv());
