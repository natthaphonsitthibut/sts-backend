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

/** ISO weekday (1=Monday..7=Sunday) for a `YYYY-MM-DD` Bangkok calendar date. */
export function getIsoDayOfWeekFromDateString(dateString: string): number {
  const [year, month, day] = dateString.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/**
 * Instant bounds of a Bangkok calendar day, for a `YYYY-MM-DD` string.
 * Thailand has no DST, so the offset is a fixed +07:00 and this needs no
 * timezone database lookup. `end` is the last millisecond of the day.
 */
export function getBangkokDayBounds(dateString: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateString}T00:00:00.000+07:00`),
    end: new Date(`${dateString}T23:59:59.999+07:00`),
  };
}
