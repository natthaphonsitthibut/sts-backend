import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottleName } from './throttle.config';

const ALL_THROTTLERS: ThrottleName[] = [
  'login',
  'otpRequest',
  'otpVerify',
  'mockLogin',
  'geocode',
  'followerApplication',
  'campaignLookup',
];

/**
 * Apply IP rate limiting to a single route using exactly one named throttler.
 *
 * The named throttlers are defined (with their limits) in ThrottlerModule, so
 * these decorators carry no values — only which throttler applies. ThrottlerGuard
 * otherwise runs every named throttler on a guarded route, so the others are
 * skipped here. Pure metadata: no env is read at decorator-evaluation time, which
 * is what keeps the limits sourced from the runtime config (see throttle.config.ts).
 */
function only(name: ThrottleName) {
  const skip = ALL_THROTTLERS.filter((n) => n !== name).reduce<Record<string, boolean>>(
    (acc, n) => {
      acc[n] = true;
      return acc;
    },
    {},
  );
  return applyDecorators(UseGuards(ThrottlerGuard), SkipThrottle(skip));
}

export const ThrottleLogin = () => only('login');
export const ThrottleOtpRequest = () => only('otpRequest');
export const ThrottleOtpVerify = () => only('otpVerify');
export const ThrottleMockLogin = () => only('mockLogin');
export const ThrottleGeocode = () => only('geocode');
export const ThrottleFollowerApplication = () => only('followerApplication');
export const ThrottleCampaignLookup = () => only('campaignLookup');
