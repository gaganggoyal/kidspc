import { describe, expect, it } from 'vitest';
import type { ChildPolicy } from '@kidpc/shared';
import { MAX_SESSION_MINUTES, evaluateAppLaunch, evaluateSessionStart, visibleApps } from './index.js';

const ist = (iso: string) => new Date(`${iso}+05:30`);

function policy(over: Partial<ChildPolicy> = {}): ChildPolicy {
  return {
    childId: 'kid_test',
    dailyMinutes: 60,
    weeklyMinutes: null,
    allowedWindows: [],
    allowedAppIds: ['paint', 'scratch'],
    sessionSummaries: false,
    idleTimeoutMinutes: 12,
    grantedForBand: 'builder',
    updatedAt: new Date(0),
    ...over,
  };
}

function request(over: Partial<Parameters<typeof evaluateSessionStart>[0]> = {}) {
  return evaluateSessionStart({
    policy: policy(),
    band: 'builder',
    consentGranted: true,
    archived: false,
    usage: { todayMinutes: 0, weekMinutes: 0 },
    now: ist('2026-03-11T16:00:00'), // Wednesday afternoon
    ...over,
  });
}

describe('evaluateSessionStart', () => {
  it('grants the full daily budget when nothing else binds', () => {
    const d = request();
    expect(d.allowed).toBe(true);
    if (!d.allowed) return;
    expect(d.grantedMinutes).toBe(60);
    expect(d.limitedBy).toBe('daily_budget');
    expect(d.deadline).toEqual(ist('2026-03-11T17:00:00'));
  });

  it('reports the consent gap before anything else', () => {
    // A child with no consent AND no time left should hear about consent: it is
    // the answer a parent would consider correct.
    const d = request({
      consentGranted: false,
      usage: { todayMinutes: 999, weekMinutes: 999 },
    });
    expect(d).toMatchObject({ allowed: false, reason: 'consent_required', retryAt: null });
  });

  it('refuses an archived profile outright', () => {
    expect(request({ archived: true })).toMatchObject({
      allowed: false,
      reason: 'profile_archived',
    });
  });

  it('subtracts time already used today', () => {
    const d = request({ usage: { todayMinutes: 45, weekMinutes: 45 } });
    expect(d).toMatchObject({ allowed: true, grantedMinutes: 15 });
  });

  it('denies once the daily budget is spent and points at tomorrow', () => {
    const d = request({ usage: { todayMinutes: 60, weekMinutes: 60 } });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('daily_budget_exhausted');
    expect(d.retryAt).toEqual(ist('2026-03-12T00:00:00'));
  });

  it('enforces the weekly cap on top of the daily one', () => {
    const d = request({
      policy: policy({ weeklyMinutes: 300 }),
      usage: { todayMinutes: 10, weekMinutes: 280 },
    });
    expect(d).toMatchObject({ allowed: true, grantedMinutes: 20, limitedBy: 'weekly_budget' });
  });

  it('sends an exhausted weekly budget to the following Monday', () => {
    const d = request({
      policy: policy({ weeklyMinutes: 300 }),
      usage: { todayMinutes: 0, weekMinutes: 300 },
    });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('weekly_budget_exhausted');
    expect(d.retryAt).toEqual(ist('2026-03-16T00:00:00')); // Monday
  });

  it('caps a generous budget at the maximum lease length', () => {
    const d = request({ policy: policy({ dailyMinutes: 600 }) });
    expect(d).toMatchObject({
      allowed: true,
      grantedMinutes: MAX_SESSION_MINUTES,
      limitedBy: 'max_session',
    });
  });
});

describe('allowed windows', () => {
  const afterSchool = policy({
    dailyMinutes: 120,
    allowedWindows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:30' }],
  });

  it('clamps the grant to the end of the open window', () => {
    const d = request({ policy: afterSchool, now: ist('2026-03-11T17:00:00') });
    expect(d).toMatchObject({ allowed: true, grantedMinutes: 90, limitedBy: 'window_end' });
  });

  it('denies before the window opens and says when to come back', () => {
    const d = request({ policy: afterSchool, now: ist('2026-03-11T09:00:00') });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('outside_window');
    expect(d.retryAt).toEqual(ist('2026-03-11T16:00:00'));
  });

  it('skips the weekend when the window is weekdays only', () => {
    // Friday 20:00 -- the window has closed and does not reopen until Monday.
    const d = request({ policy: afterSchool, now: ist('2026-03-13T20:00:00') });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.retryAt).toEqual(ist('2026-03-16T16:00:00'));
  });

  it('honours a window that wraps past midnight', () => {
    const holiday = policy({
      dailyMinutes: 240,
      allowedWindows: [{ days: [], start: '21:00', end: '01:00' }],
    });
    const lateNight = request({ policy: holiday, now: ist('2026-03-11T23:30:00') });
    expect(lateNight).toMatchObject({ allowed: true, grantedMinutes: 90, limitedBy: 'window_end' });

    // 00:30 belongs to the window that opened the previous evening.
    const pastMidnight = request({ policy: holiday, now: ist('2026-03-12T00:30:00') });
    expect(pastMidnight).toMatchObject({ allowed: true, grantedMinutes: 30 });
  });

  it('does not open a wrapping window on a day it was never granted', () => {
    // Window applies Saturdays only; 00:30 Sunday continues Saturday's window,
    // but 00:30 Saturday does not (Friday had no window).
    const saturdayOnly = policy({
      allowedWindows: [{ days: [6], start: '21:00', end: '01:00' }],
    });
    expect(request({ policy: saturdayOnly, now: ist('2026-03-15T00:30:00') })).toMatchObject({
      allowed: true,
    });
    expect(request({ policy: saturdayOnly, now: ist('2026-03-14T00:30:00') })).toMatchObject({
      allowed: false,
      reason: 'outside_window',
    });
  });
});

describe('evaluateAppLaunch', () => {
  it('allows an app that is both age-appropriate and switched on', () => {
    expect(evaluateAppLaunch(policy(), 'builder', 'scratch')).toMatchObject({ allowed: true });
  });

  it('blocks an app above the child band even when a parent granted it', () => {
    const permissive = policy({ allowedAppIds: ['thonny'] });
    expect(evaluateAppLaunch(permissive, 'explorer', 'thonny')).toMatchObject({
      allowed: false,
      reason: 'band_too_low',
    });
  });

  it('blocks an age-appropriate app the parent turned off', () => {
    expect(evaluateAppLaunch(policy({ allowedAppIds: [] }), 'builder', 'scratch')).toMatchObject({
      allowed: false,
      reason: 'not_allowed_by_parent',
    });
  });

  it('rejects unknown app ids', () => {
    expect(evaluateAppLaunch(policy(), 'builder', 'doom')).toMatchObject({
      allowed: false,
      reason: 'unknown_app',
    });
  });

  it('shows the launcher only what passes both gates', () => {
    const ids = visibleApps(policy({ allowedAppIds: ['paint', 'scratch', 'thonny'] }), 'builder').map(
      (a) => a.id,
    );
    expect(ids).toEqual(['paint', 'scratch']);
  });
});
