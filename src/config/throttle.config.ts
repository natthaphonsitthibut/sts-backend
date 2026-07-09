import { registerAs } from '@nestjs/config';

/**
 * IP-based rate limiting (H1 brute-force defense) for the unauthenticated /
 * credential-checking endpoints. Limits are centralised here and env-overridable.
 *
 * Read at runtime via `ThrottlerModule.forRootAsync` (NOT at import time) so the
 * values come from the fully-loaded config — `.env` is only merged into
 * `process.env` when `ConfigModule.forRoot` runs, which is after module
 * decorators evaluate. The `@nestjs/throttler` TTL is in milliseconds.
 *
 * NOTE: the throttler uses an in-memory store — correct for the current single
 * instance. Before horizontal scaling these counters (and the DB-backed OTP
 * lockout) must move to a shared store (Redis) or attackers can spread requests
 * across instances. See task-performance-scaling.md.
 */
export interface ThrottleRule {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds (what @nestjs/throttler expects). */
  ttlMs: number;
}

/** Named throttlers, referenced by the per-route decorators in throttle.decorators.ts. */
export type ThrottleName =
  | 'login'
  | 'otpRequest'
  | 'otpVerify'
  | 'mockLogin'
  | 'geocode'
  | 'followerApplication'
  | 'campaignLookup';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function rule(
  limitEnv: string | undefined,
  ttlSecondsEnv: string | undefined,
  limitDefault: number,
  ttlSecondsDefault: number,
): ThrottleRule {
  return {
    limit: parsePositiveInt(limitEnv, limitDefault),
    ttlMs: parsePositiveInt(ttlSecondsEnv, ttlSecondsDefault) * 1000,
  };
}

/**
 * Per-endpoint rules. Conservative defaults:
 *  - login        5 / minute   (password guessing)
 *  - otpRequest   3 / 5 min    (OTP email spam)
 *  - otpVerify   10 / minute   (IP-level OTP guessing; the per-link DB lockout
 *                               is the primary cap, this caps IP rotation)
 *  - mockLogin   10 / minute   (mock ThaID student login)
 *  - geocode     30 / minute   (billable Google Maps proxy + address PII)
 *  - followerApplication  3 / 10 min  (public อสม. application form — no auth, spam-prone)
 *  - campaignLookup      20 / minute  (public recruitment-link lookup by code — normal page loads,
 *                                      capped against scraping/DoS since the endpoint is unauthenticated)
 */
export const throttleConfig = registerAs('throttle', () => ({
  login: rule(process.env.RATE_LIMIT_LOGIN, process.env.RATE_LIMIT_LOGIN_TTL, 5, 60),
  otpRequest: rule(
    process.env.RATE_LIMIT_OTP_REQUEST,
    process.env.RATE_LIMIT_OTP_REQUEST_TTL,
    3,
    300,
  ),
  otpVerify: rule(process.env.RATE_LIMIT_OTP_VERIFY, process.env.RATE_LIMIT_OTP_VERIFY_TTL, 10, 60),
  mockLogin: rule(process.env.RATE_LIMIT_MOCK_LOGIN, process.env.RATE_LIMIT_MOCK_LOGIN_TTL, 10, 60),
  geocode: rule(process.env.RATE_LIMIT_GEOCODE, process.env.RATE_LIMIT_GEOCODE_TTL, 30, 60),
  followerApplication: rule(
    process.env.RATE_LIMIT_FOLLOWER_APPLICATION,
    process.env.RATE_LIMIT_FOLLOWER_APPLICATION_TTL,
    3,
    600,
  ),
  campaignLookup: rule(
    process.env.RATE_LIMIT_CAMPAIGN_LOOKUP,
    process.env.RATE_LIMIT_CAMPAIGN_LOOKUP_TTL,
    20,
    60,
  ),
}));
