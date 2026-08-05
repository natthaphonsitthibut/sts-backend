/**
 * Single ceiling for how long any magic link may stay usable, whether the
 * lifetime arrives as a duration (create) or as an explicit deadline (create
 * with an assignment window, or delegation). One constant keeps the two entry
 * points from drifting into different link-lifetime policies.
 */
export const MAX_LINK_LIFETIME_HOURS = 2160;

export const MAX_LINK_LIFETIME_MS = MAX_LINK_LIFETIME_HOURS * 60 * 60 * 1000;
