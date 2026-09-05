/**
 * Wall-clock helpers.
 *
 * Screen-time budgets and curfews are things parents reason about in local
 * wall-clock terms ("an hour a day", "nothing after 8pm"), so every budget
 * boundary is computed in the household's timezone rather than in UTC.
 * India is the launch market, hence the default.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: Weekday;
}

const WEEKDAY_INDEX: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localParts(at: Date, timeZone: string = DEFAULT_TIMEZONE): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  // Intl renders midnight as hour "24" in some ICU builds; normalise it.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Stable `YYYY-MM-DD` key for "which local day does this instant belong to". */
export function localDayKey(at: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = localParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes elapsed since local midnight, 0-1439. */
export function minutesSinceLocalMidnight(
  at: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): number {
  const p = localParts(at, timeZone);
  return p.hour * 60 + p.minute;
}

export function localWeekday(at: Date, timeZone: string = DEFAULT_TIMEZONE): Weekday {
  return localParts(at, timeZone).weekday;
}

/** `"HH:MM"` -> minutes since midnight. Throws on malformed input. */
export function parseClockTime(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new RangeError(`Invalid clock time: ${value} (expected HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatClockTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Whether `minute` falls in the window [start, end).
 * Windows that wrap past midnight (e.g. 21:00-06:00) are supported.
 */
export function withinWindow(minute: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin
    ? minute >= startMin && minute < endMin
    : minute >= startMin || minute < endMin;
}
