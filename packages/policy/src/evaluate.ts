import {
  CATALOG,
  type AgeBand,
  type AllowedWindow,
  type CatalogApp,
  type ChildPolicy,
  DEFAULT_TIMEZONE,
  type SessionLimit,
  type Weekday,
  bandAtLeast,
  findApp,
  localParts,
  localWeekday,
  minutesSinceLocalMidnight,
  parseClockTime,
  withinWindow,
} from '@kidpc/shared';

/**
 * The policy engine is the one place that decides whether a child may use the
 * computer right now, and for how long. It is deliberately pure: no clock, no
 * database, no I/O. Everything it needs is passed in, which is what makes the
 * awkward cases (curfews that wrap past midnight, a budget that runs out
 * mid-session, a week boundary) cheap to test.
 */

/** Upper bound on any single lease, so a forgotten session cannot pin a container all day. */
export const MAX_SESSION_MINUTES = 180;

export type DenyReason =
  | 'consent_required'
  | 'profile_archived'
  | 'age_unsupported'
  | 'outside_window'
  | 'daily_budget_exhausted'
  | 'weekly_budget_exhausted';

export interface Allow {
  allowed: true;
  /**
   * Minutes the session may run before it must be torn down. This is the
   * minimum of every applicable limit, so the broker needs only this number.
   */
  grantedMinutes: number;
  /** Hard deadline derived from `grantedMinutes`. */
  deadline: Date;
  /** Which limit produced the deadline -- shown to the child as a countdown label. */
  limitedBy: SessionLimit;
}

export interface Deny {
  allowed: false;
  reason: DenyReason;
  /** Written for a child to read. */
  userMessage: string;
  /** When this would next succeed, if it is a matter of waiting. */
  retryAt: Date | null;
}

export type SessionDecision = Allow | Deny;

export interface SessionRequest {
  policy: ChildPolicy;
  band: AgeBand | null;
  consentGranted: boolean;
  archived: boolean;
  usage: { todayMinutes: number; weekMinutes: number };
  now: Date;
  timezone?: string;
}

const MINUTE_MS = 60_000;

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS);
}

function windowAppliesOn(window: AllowedWindow, day: Weekday): boolean {
  return window.days.length === 0 || window.days.includes(day);
}

/**
 * Minutes remaining in the currently-open window, or null when no window is
 * open. An empty policy means "no time-of-day restriction", which we model as
 * an open window with no end.
 */
function minutesLeftInOpenWindow(
  windows: AllowedWindow[],
  nowMinute: number,
  today: Weekday,
): number | null {
  if (windows.length === 0) return Number.POSITIVE_INFINITY;

  let best: number | null = null;
  for (const w of windows) {
    const start = parseClockTime(w.start);
    const end = parseClockTime(w.end);
    const wraps = start > end;
    // A window that wraps past midnight is open "today" if we are after its
    // start, and also if we are before its end -- but in the latter case it
    // began yesterday, so it only counts when it applied yesterday.
    const startedToday = withinWindow(nowMinute, start, wraps ? 1440 : end) && nowMinute >= start;
    const startedYesterday = wraps && nowMinute < end;
    const applies = startedToday
      ? windowAppliesOn(w, today)
      : startedYesterday
        ? windowAppliesOn(w, ((today + 6) % 7) as Weekday)
        : false;
    if (!applies) continue;

    const remaining = wraps && startedToday ? 1440 - nowMinute + end : end - nowMinute;
    if (best === null || remaining > best) best = remaining;
  }
  return best;
}

/** Local midnight `daysAhead` days from `now`, as an instant. */
function localMidnight(now: Date, timezone: string, daysAhead: number): Date {
  const minutesIntoDay = minutesSinceLocalMidnight(now, timezone);
  return addMinutes(now, 1440 * daysAhead - minutesIntoDay);
}

/** The next instant a window opens, searching up to a week ahead. */
function nextWindowStart(
  windows: AllowedWindow[],
  now: Date,
  timezone: string,
  notBefore: Date,
): Date | null {
  if (windows.length === 0) return notBefore;
  const today = localWeekday(now, timezone);
  const nowMinute = minutesSinceLocalMidnight(now, timezone);

  let best: Date | null = null;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const day = ((today + dayOffset) % 7) as Weekday;
    for (const w of windows) {
      if (!windowAppliesOn(w, day)) continue;
      const start = parseClockTime(w.start);
      if (dayOffset === 0 && start <= nowMinute) continue;
      const at = addMinutes(localMidnight(now, timezone, dayOffset), start);
      if (at < notBefore) continue;
      if (best === null || at < best) best = at;
    }
    if (best) break;
  }
  return best;
}

/** Start of the next ISO week (Monday 00:00 local). */
function nextWeekStart(now: Date, timezone: string): Date {
  const today = localWeekday(now, timezone);
  const daysUntilMonday = today === 1 ? 7 : (8 - today) % 7 || 7;
  return localMidnight(now, timezone, daysUntilMonday);
}

/**
 * Decide whether a session may start, and for how long.
 *
 * Checks run cheapest-and-most-fundamental first so the reason we report is the
 * one a parent would consider the real answer: a child with no consent on file
 * is told about consent, not about their bedtime.
 */
export function evaluateSessionStart(req: SessionRequest): SessionDecision {
  const tz = req.timezone ?? DEFAULT_TIMEZONE;
  const { policy, usage, now } = req;

  if (req.archived) {
    return {
      allowed: false,
      reason: 'profile_archived',
      userMessage: 'This profile has been turned off.',
      retryAt: null,
    };
  }
  if (!req.consentGranted) {
    return {
      allowed: false,
      reason: 'consent_required',
      userMessage: 'Ask a grown-up to finish setting up your account.',
      retryAt: null,
    };
  }
  if (req.band === null) {
    return {
      allowed: false,
      reason: 'age_unsupported',
      userMessage: 'This account is for children aged 5 and up.',
      retryAt: null,
    };
  }

  const nowMinute = minutesSinceLocalMidnight(now, tz);
  const today = localWeekday(now, tz);
  const windowLeft = minutesLeftInOpenWindow(policy.allowedWindows, nowMinute, today);

  if (windowLeft === null) {
    const retryAt = nextWindowStart(policy.allowedWindows, now, tz, now);
    return {
      allowed: false,
      reason: 'outside_window',
      userMessage: 'Computer time is over for now. Come back later!',
      retryAt,
    };
  }

  const dailyLeft = policy.dailyMinutes - usage.todayMinutes;
  if (dailyLeft <= 0) {
    const midnight = localMidnight(now, tz, 1);
    return {
      allowed: false,
      reason: 'daily_budget_exhausted',
      userMessage: "You've used all your computer time for today. See you tomorrow!",
      retryAt: nextWindowStart(policy.allowedWindows, now, tz, midnight) ?? midnight,
    };
  }

  const weeklyLeft =
    policy.weeklyMinutes === null
      ? Number.POSITIVE_INFINITY
      : policy.weeklyMinutes - usage.weekMinutes;
  if (weeklyLeft <= 0) {
    const weekStart = nextWeekStart(now, tz);
    return {
      allowed: false,
      reason: 'weekly_budget_exhausted',
      userMessage: "You've used all your computer time this week. It starts again on Monday!",
      retryAt: nextWindowStart(policy.allowedWindows, now, tz, weekStart) ?? weekStart,
    };
  }

  const candidates: Array<[number, SessionLimit]> = [
    [dailyLeft, 'daily_budget'],
    [weeklyLeft, 'weekly_budget'],
    [windowLeft, 'window_end'],
    [MAX_SESSION_MINUTES, 'max_session'],
  ];
  let grantedMinutes = Number.POSITIVE_INFINITY;
  let limitedBy: SessionLimit = 'max_session';
  for (const [value, label] of candidates) {
    if (value < grantedMinutes) {
      grantedMinutes = value;
      limitedBy = label;
    }
  }
  grantedMinutes = Math.floor(grantedMinutes);

  return {
    allowed: true,
    grantedMinutes,
    deadline: addMinutes(now, grantedMinutes),
    limitedBy,
  };
}

// ---------------------------------------------------------------------------
// App gating
// ---------------------------------------------------------------------------

export type AppDenyReason = 'unknown_app' | 'band_too_low' | 'not_allowed_by_parent';

export type AppDecision =
  | { allowed: true; app: CatalogApp }
  | { allowed: false; reason: AppDenyReason; userMessage: string };

/**
 * Two independent gates, both of which must pass: the app must suit the
 * child's band, and the parent must have left it switched on. Neither one
 * implies the other, and we never let a parent grant an app above the band --
 * age suitability is not theirs to waive.
 */
export function evaluateAppLaunch(
  policy: Pick<ChildPolicy, 'allowedAppIds'>,
  band: AgeBand,
  appId: string,
): AppDecision {
  const app = findApp(appId);
  if (!app) {
    return { allowed: false, reason: 'unknown_app', userMessage: 'That app is not available.' };
  }
  if (!bandAtLeast(band, app.minBand)) {
    return {
      allowed: false,
      reason: 'band_too_low',
      userMessage: "This one unlocks when you're a bit older.",
    };
  }
  if (!policy.allowedAppIds.includes(appId)) {
    return {
      allowed: false,
      reason: 'not_allowed_by_parent',
      userMessage: 'A grown-up has turned this one off.',
    };
  }
  return { allowed: true, app };
}

/** The catalogue as this specific child should see it, in launcher order. */
export function visibleApps(
  policy: Pick<ChildPolicy, 'allowedAppIds'>,
  band: AgeBand,
): CatalogApp[] {
  const allowed = new Set(policy.allowedAppIds);
  return CATALOG.filter((app) => bandAtLeast(band, app.minBand) && allowed.has(app.id));
}

/** Convenience for the UI: how much time is left today, floored at zero. */
export function remainingToday(policy: ChildPolicy, todayMinutes: number): number {
  return Math.max(0, policy.dailyMinutes - todayMinutes);
}

/** Local day key helper re-exported so callers need one import for budgeting. */
export { localParts };
