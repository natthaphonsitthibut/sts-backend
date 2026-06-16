/** Project timezone. Attendance/stat "days" are Thai calendar days, not UTC. */
export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/**
 * Today's calendar date as `YYYY-MM-DD` in Asia/Bangkok, independent of the
 * server's timezone. Use this for any "what day is it" logic (attendance dates,
 * daily stats, history defaults) — `new Date().toISOString().split('T')[0]`
 * returns the UTC day, which rolls over 7h early and mis-dates Thai records.
 */
export function getBangkokDateString(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; timeZone shifts the instant to Bangkok first.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
