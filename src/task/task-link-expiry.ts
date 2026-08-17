/**
 * Single ceiling for how long any magic link may stay usable, whether the
 * lifetime arrives as a duration or explicit assignment deadline. One constant
 * keeps all home-visit link creation paths on the same policy.
 */
export const MAX_LINK_LIFETIME_HOURS = 2160;

export const MAX_LINK_LIFETIME_MS = MAX_LINK_LIFETIME_HOURS * 60 * 60 * 1000;
