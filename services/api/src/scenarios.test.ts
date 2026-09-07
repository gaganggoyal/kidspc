import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { REFERRAL_BONUS_DAYS, TRIAL_DAYS, planById, referralCodeFor, trialDaysFor } from '@kidpc/shared';
import { type Harness, createHarness, ist, onboard } from './testing/harness.js';
import { consentChallenges, emailOutbox, planOrders } from './db/schema.js';
import { backoffMinutes, sendPending } from './email/outbox.js';

/**
 * End-user scenarios.
 *
 * These are written as the situations a real household lands in -- a school
 * night, a shared TV, a child who wanders off mid-session -- rather than as
 * unit tests of a function. They exist because the interesting failures in this
 * system are not "does the policy engine return the right number" but "does an
 * ordinary Tuesday work end to end", and those only show up when the clock,
 * the budget, the curfew and the desktop lifecycle are moving at once.
 *
 * Every one of them drives the real HTTP surface.
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

async function open(startAt: Date, env: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  harness = await createHarness(startAt, env);
  return harness;
}

/**
 * `inject` sets the content type itself when a payload is given. Setting it by
 * hand on a request with no body makes Fastify reject it as malformed JSON --
 * which is how the archive scenario below first "failed".
 */
const asKid = (token: string) => ({ authorization: `Bearer ${token}` });
const asParent = asKid;

// ---------------------------------------------------------------------------

describe('Scenario: a school night', () => {
  /** Ravi, 10. 45 minutes a day, only between 16:00 and 18:30 on weekdays. */
  const schoolNight = {
    dailyMinutes: 45,
    allowedWindows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:30' }],
    allowedAppIds: ['scratch', 'paint', 'typing'],
  };

  it('turns him away before school and tells him when to come back', async () => {
    const h = await open(ist('2026-03-11T07:30:00')); // Wednesday, before school
    const { kid } = await onboard(
      h,
      'schoolnight@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      schoolNight,
    );

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().canStart).toBe(false);
    expect(home.json().blocked).toMatchObject({
      reason: 'outside_window',
      retryAt: '2026-03-11T10:30:00.000Z', // 16:00 IST the same day
    });
    // The message a seven-year-old reads, not a policy code.
    expect(home.json().blocked.message).toMatch(/come back later/i);

    const attempt = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('lets him in when the window opens and grants the whole daily budget', async () => {
    const h = await open(ist('2026-03-11T16:00:00'));
    const { kid } = await onboard(
      h,
      'schoolnight2@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      schoolNight,
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'scratch' },
    });
    expect(started.statusCode).toBe(201);
    // The window has 150 minutes left but the daily budget is 45, so the
    // tighter limit wins.
    expect(started.json().grantedMinutes).toBe(45);
  });

  it('cuts the session at the window edge even with budget to spare', async () => {
    const h = await open(ist('2026-03-11T18:00:00')); // 30 minutes of window left
    const { kid } = await onboard(
      h,
      'schoolnight3@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      schoolNight,
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    expect(started.json().grantedMinutes).toBe(30);

    h.advanceMinutes(31);
    const beat = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });
    expect(beat.json().state).toBe('terminated');
  });

  it('sends him to tomorrow afternoon once the day is spent, not to midnight', async () => {
    const h = await open(ist('2026-03-11T16:00:00'));
    const { kid } = await onboard(
      h,
      'schoolnight4@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      schoolNight,
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    h.advanceMinutes(46);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().blocked.reason).toBe('daily_budget_exhausted');
    // Midnight would be wrong: the window does not open again until 16:00.
    expect(home.json().blocked.retryAt).toBe('2026-03-12T10:30:00.000Z');
  });

  it('skips the weekend when the window is weekdays only', async () => {
    const h = await open(ist('2026-03-13T19:00:00')); // Friday, window closed
    const { kid } = await onboard(
      h,
      'schoolnight5@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      schoolNight,
    );

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().blocked.retryAt).toBe('2026-03-16T10:30:00.000Z'); // Monday 16:00 IST
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: two siblings, one television', () => {
  it('keeps their budgets, sessions and desktops entirely separate', async () => {
    const h = await open(ist('2026-03-14T10:00:00')); // Saturday, no windows
    const guardian = await h.registerGuardian('siblings@example.com');

    const meeraId = await h.createChild(guardian, {
      displayName: 'Meera',
      birthYear: 2019,
      birthMonth: 4,
      pin: '1111',
    });
    const anayaId = await h.createChild(guardian, {
      displayName: 'Anaya',
      birthYear: 2011,
      birthMonth: 2,
      pin: '3333',
    });
    await h.grantConsent(guardian, meeraId);
    await h.grantConsent(guardian, anayaId);

    const meera = await h.childToken(guardian, meeraId, '1111');
    const anaya = await h.childToken(guardian, anayaId, '3333');

    // Different ages, different defaults, different catalogues.
    const meeraHome = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(meera) });
    const anayaHome = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(anaya) });
    expect(meeraHome.json().child.band).toBe('explorer');
    expect(anayaHome.json().child.band).toBe('coder');
    expect(meeraHome.json().time.dailyMinutes).toBe(30);
    expect(anayaHome.json().time.dailyMinutes).toBe(60);
    expect(meeraHome.json().apps.map((a: { id: string }) => a.id)).not.toContain('thonny');
    expect(anayaHome.json().apps.map((a: { id: string }) => a.id)).toContain('thonny');

    // Meera plays for 20 minutes.
    const meeraSession = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(meera),
      payload: { appId: 'paint' },
    });
    h.advanceMinutes(20);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${meeraSession.json().id}/heartbeat`,
      headers: asKid(meera),
    });

    // Anaya's day is untouched by her sister's.
    const anayaAfter = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(anaya) });
    expect(anayaAfter.json().time.usedTodayMinutes).toBe(0);
    expect(anayaAfter.json().time.remainingMinutes).toBe(60);

    // And she cannot touch her sister's session.
    const meddle = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${meeraSession.json().id}/heartbeat`,
      headers: asKid(anaya),
    });
    expect(meddle.statusCode).toBe(404);

    // Two children, two desktops, at the same time.
    await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(anaya),
      payload: {},
    });
    const live = await h.runtime.ctx.repos.sessions.allLive();
    expect(live).toHaveLength(2);
    expect(new Set(live.map((s) => s.childId)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: homework that runs past midnight', () => {
  it("bills each minute to the day it was actually spent", async () => {
    const h = await open(ist('2026-03-14T23:40:00')); // Saturday night
    const { kid } = await onboard(
      h,
      'latenight@example.com',
      { displayName: 'Anaya', birthYear: 2011, birthMonth: 2, pin: '3333' },
      { dailyMinutes: 120, allowedAppIds: ['office', 'thonny'] },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'office' },
    });

    h.advanceMinutes(40); // 23:40 -> 00:20
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });

    // Sunday should have been charged 20 minutes, not 0 and not 40. Charging
    // the whole stretch to Saturday would hand her a free 40 minutes; charging
    // it all to Sunday would eat a third of the next day's allowance.
    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().time.usedTodayMinutes).toBe(20);
    expect(home.json().time.remainingMinutes).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: the weekly cap', () => {
  it('stops a Saturday marathon and points at Monday', async () => {
    const h = await open(ist('2026-03-14T09:00:00')); // Saturday
    const { childId, kid } = await onboard(
      h,
      'weekly@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 120, weeklyMinutes: 300, allowedAppIds: ['scratch'] },
    );

    // Pretend Monday through Friday already consumed 280 minutes.
    for (const day of ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12']) {
      await h.runtime.ctx.repos.sessions.addUsageMinutes(childId, day, 70);
    }

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().canStart).toBe(true);

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    // 20 minutes left in the week, even though today's budget is 120.
    expect(started.json().grantedMinutes).toBe(20);

    h.advanceMinutes(21);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });

    const after = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(after.json().blocked.reason).toBe('weekly_budget_exhausted');
    expect(after.json().blocked.retryAt).toBe('2026-03-15T18:30:00.000Z'); // Monday 00:00 IST
    expect(after.json().blocked.message).toMatch(/monday/i);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: the child who wanders off', () => {
  it('reclaims the desktop and does not bill the time nobody was there', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(
      h,
      'idle@example.com',
      { displayName: 'Meera', birthYear: 2019, birthMonth: 4, pin: '1111' },
      { dailyMinutes: 60, allowedAppIds: ['paint'], idleTimeoutMinutes: 10 },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });
    const sessionId = started.json().id;

    // She paints for 10 minutes...
    h.advanceMinutes(10);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/heartbeat`,
      headers: asKid(kid),
    });

    // ...then is called for dinner. Nothing happens for 12 minutes.
    h.advanceMinutes(12);
    const swept = await h.runtime.ctx.manager.reap();
    expect(swept.ended).toBe(1);

    const session = await h.runtime.ctx.repos.sessions.byId(sessionId);
    expect(session?.endReason).toBe('idle_timeout');

    // The desktop is gone, so we stop paying for it. But Meera must not be
    // charged for the 12 minutes she was at the dinner table -- a parent
    // checking the dashboard would call that a bug, and they would be right.
    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().time.usedTodayMinutes).toBe(10);
    expect(session?.billedMinutes).toBe(10);
  });

  it('survives a few minutes of bad wifi without ending the session', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(
      h,
      'flaky@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 60, allowedAppIds: ['scratch'], idleTimeoutMinutes: 12 },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });

    h.advanceMinutes(5);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });

    // Wifi drops for four minutes -- under the idle ceiling.
    h.advanceMinutes(4);
    expect((await h.runtime.ctx.manager.reap()).ended).toBe(0);

    // He is still there when it comes back.
    const resumed = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().state).toBe('active');
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a parent changes their mind', () => {
  it('does not shorten a session already in progress, but binds the next one', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(
      h,
      'tighten@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 60, allowedAppIds: ['scratch', 'paint'] },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    expect(started.json().grantedMinutes).toBe(60);

    h.advanceMinutes(20);
    // Mid-session, a parent cuts the daily budget to the 20 minutes already
    // spent, leaving nothing for a second session today.
    await h.setPolicy(guardian, childId, {
      dailyMinutes: 20,
      allowedAppIds: ['paint'],
    });

    // The lease he already holds is honoured: yanking a child off mid-drawing
    // because a parent edited a number in another room is the wrong behaviour.
    const beat = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });
    expect(beat.json().state).toBe('active');

    // He finishes; the new limit binds from the next request onwards.
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/end`,
      headers: asKid(kid),
    });
    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().canStart).toBe(false);
    expect(home.json().blocked.reason).toBe('daily_budget_exhausted');
    // And Scratch is gone from his launcher.
    expect(home.json().apps.map((a: { id: string }) => a.id)).toEqual(['paint']);
  });

  it('ends the session immediately when a parent archives the profile', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(
      h,
      'archive@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 60, allowedAppIds: ['scratch'] },
    );

    await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });

    await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/archive`,
      headers: asParent(guardian),
    });

    // Unlike a policy edit, this takes effect on the TV now.
    expect(await h.runtime.ctx.repos.sessions.liveForChild(childId)).toBeNull();
    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().canStart).toBe(false);
    expect(home.json().blocked.reason).toBe('profile_archived');
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a birthday', () => {
  it('moves the child up a band and unlocks what that band brings', async () => {
    // Born May 2017. In April 2026 she is 8 (Explorer); in June she is 9 (Builder).
    const h = await open(ist('2026-04-10T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'birthday@example.com', {
      displayName: 'Priya',
      birthYear: 2017,
      birthMonth: 5,
      pin: '4444',
    });

    const before = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(before.json().child.band).toBe('explorer');
    expect(before.json().apps.map((a: { id: string }) => a.id)).not.toContain('scratch');

    // Two months pass.
    h.setClock(ist('2026-06-10T10:00:00'));

    const household = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: asParent(guardian),
    });
    const grown = household.json().children.find((c: { id: string }) => c.id === childId);
    expect(grown.band).toBe('builder');
    expect(grown.age).toBe(9);

    // The launcher promises apps unlock with age. They must actually appear,
    // without a parent having to notice the birthday and grant them by hand.
    const after = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(after.json().child.band).toBe('builder');
    expect(after.json().apps.map((a: { id: string }) => a.id)).toContain('scratch');
  });

  it('does not re-grant an app the parent deliberately switched off', async () => {
    const h = await open(ist('2026-04-10T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'birthday2@example.com', {
      displayName: 'Priya',
      birthYear: 2017,
      birthMonth: 5,
      pin: '4444',
    });

    // A parent turns off the typing game while she is still an Explorer.
    await h.setPolicy(guardian, childId, {
      dailyMinutes: 30,
      allowedAppIds: ['paint', 'gcompris', 'blocks'],
    });

    h.setClock(ist('2026-06-10T10:00:00'));
    const after = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    const ids = after.json().apps.map((a: { id: string }) => a.id);

    expect(ids).toContain('scratch'); // newly unlocked by the band change
    expect(ids).not.toContain('typing'); // a decision the parent already made
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: things go wrong', () => {
  it('tells a child in their own words when no desktop is available', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(
      h,
      'capacity@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 60, allowedAppIds: ['scratch'] },
    );

    // Every desktop on the estate is busy.
    const driver = (h.runtime.ctx.manager as unknown as { driver: { provision: unknown } }).driver;
    const original = driver.provision;
    driver.provision = async () => {
      throw new Error('no capacity on any host');
    };

    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('no_capacity');
    expect(res.json().error.message).toMatch(/busy right now/i);
    // Nothing was charged for a session the child never got.
    driver.provision = original;

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().time.usedTodayMinutes).toBe(0);
  });

  it('closes the record honestly when a desktop dies underneath a child', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(
      h,
      'crash@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 60, allowedAppIds: ['scratch'] },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    const sessionId = started.json().id;

    h.advanceMinutes(8);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/heartbeat`,
      headers: asKid(kid),
    });

    // The container falls over.
    const session = await h.runtime.ctx.repos.sessions.byId(sessionId);
    const driver = (
      h.runtime.ctx.manager as unknown as { driver: { killUnderlying: (ref: string) => void } }
    ).driver;
    driver.killUnderlying(session!.driverRef!);

    await h.runtime.ctx.manager.reap();

    const closed = await h.runtime.ctx.repos.sessions.byId(sessionId);
    expect(closed?.endReason).toBe('system_error');
    // He keeps the 8 minutes he actually had, and is not charged for the crash.
    expect(closed?.billedMinutes).toBe(8);

    // And he can start again rather than being stuck.
    const retry = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().grantedMinutes).toBe(52);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a household in another timezone', () => {
  it('rolls the day over on the household clock, not on UTC', async () => {
    // 20:00 in London is 00:30 the next day in Kolkata. A household set to
    // London must still be on "today" at 20:00 local.
    const h = await open(new Date('2026-03-14T20:00:00Z'));
    const guardian = await h.registerGuardian('london@example.com', 'Europe/London');
    const childId = await h.createChild(guardian, {
      displayName: 'Sam',
      birthYear: 2015,
      birthMonth: 9,
      pin: '5555',
    });
    await h.grantConsent(guardian, childId);
    await h.setPolicy(guardian, childId, { dailyMinutes: 60, allowedAppIds: ['scratch'] });
    const kid = await h.childToken(guardian, childId, '5555');

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    h.advanceMinutes(30);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });

    const usage = await h.app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/usage`,
      headers: asParent(guardian),
    });
    // 20:00-20:30 London is all one day there, even though it straddles
    // midnight in India.
    expect(usage.json().history.at(-1)).toEqual({ dayKey: '2026-03-14', minutes: 30 });
  });
});

describe('Scenario: the same build serving a different environment', () => {
  it('hands desktops the origin this deployment is configured with', async () => {
    // A staging deployment must not tell its desktops to load production URLs,
    // and the allow-list must agree with whatever they were told -- otherwise
    // every self-hosted app silently fails to load.
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      APPS_ORIGIN: 'https://apps.staging.kidspc.online',
    } as NodeJS.ProcessEnv);
    const h = harness;

    const { kid } = await onboard(
      h,
      'staging@example.com',
      { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, pin: '2222' },
      { dailyMinutes: 45, allowedAppIds: ['scratch', 'research'] },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: {},
    });
    const session = await h.runtime.ctx.repos.sessions.byId(started.json().id);

    const policy = await h.app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: session!.id, secret: session!.endpointSecret },
    });
    expect(policy.json().origins).toContain('https://apps.staging.kidspc.online');
    expect(policy.json().origins).not.toContain('https://apps.kidspc.online');
    // Third-party origins are absolute and unaffected by the environment.
    expect(policy.json().origins).toContain('https://kids.britannica.com');

    const health = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.json().appsOrigin).toBe('https://apps.staging.kidspc.online');
  });
});

describe('Scenario: a deployment that has no desktops (small VPS)', () => {
  /**
   * The economics of a streamed Linux desktop are brutal on a small host: ~1.5
   * GiB each, so a 16 GB box carries about seven children at once. Local
   * activities run in the child's own browser and cost the server a static
   * file, so the same box serves thousands. A lite deployment offers only
   * those -- and everything else about the product must still work.
   */
  it('offers local activities and hides the ones needing a desktop', async () => {
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      DEPLOYMENT_MODE: 'lite',
    } as NodeJS.ProcessEnv);
    const h = harness;

    const { kid } = await onboard(h, 'lite@example.com', {
      displayName: 'Anaya',
      birthYear: 2011,
      birthMonth: 2,
      pin: '3333',
    });

    // Health must report what is actually true, not what SESSION_DRIVER says.
    const health = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.json()).toMatchObject({ mode: 'lite', driver: 'none' });

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().desktopsAvailable).toBe(false);

    const ids = home.json().apps.map((a: { id: string }) => a.id);
    // A Coder would normally see Python, LibreOffice, Scratch and the research
    // browser. None of those can run without a desktop, so none are offered.
    expect(ids).not.toContain('thonny');
    expect(ids).not.toContain('office');
    expect(ids).not.toContain('scratch');
    // What remains is a real product, not a stub.
    expect(ids).toEqual(expect.arrayContaining(['paint', 'typing', 'blocks', 'numbers', 'writer', 'code']));
    expect(home.json().apps.every((a: { delivery: string }) => a.delivery === 'local')).toBe(true);
  });

  it('starts a local session without provisioning anything', async () => {
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      DEPLOYMENT_MODE: 'lite',
    } as NodeJS.ProcessEnv);
    const h = harness;
    const { kid } = await onboard(h, 'lite2@example.com', {
      displayName: 'Meera',
      birthYear: 2019,
      birthMonth: 4,
      pin: '1111',
    });

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint', deviceKind: 'tv' },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({
      delivery: 'local',
      localRoute: '/play/paint',
      streamPath: null,
      grantedMinutes: 30,
    });

    const row = await h.runtime.ctx.repos.sessions.byId(started.json().id);
    expect(row?.driverRef).toBeNull();
    expect(row?.driverName).toBe('local');
  });

  it('still enforces time budgets on local activities', async () => {
    // The cheap delivery path must not become a way around a bedtime.
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      DEPLOYMENT_MODE: 'lite',
    } as NodeJS.ProcessEnv);
    const h = harness;
    const { kid } = await onboard(
      h,
      'lite3@example.com',
      { displayName: 'Meera', birthYear: 2019, birthMonth: 4, pin: '1111' },
      { dailyMinutes: 20, allowedAppIds: ['paint', 'typing'] },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'typing' },
    });
    expect(started.json().grantedMinutes).toBe(20);

    h.advanceMinutes(21);
    const beat = await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });
    expect(beat.json().state).toBe('terminated');

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().canStart).toBe(false);
    expect(home.json().blocked.reason).toBe('daily_budget_exhausted');
  });

  it('reaps an abandoned local session like any other', async () => {
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      DEPLOYMENT_MODE: 'lite',
    } as NodeJS.ProcessEnv);
    const h = harness;
    const { kid } = await onboard(
      h,
      'lite4@example.com',
      { displayName: 'Meera', birthYear: 2019, birthMonth: 4, pin: '1111' },
      { dailyMinutes: 60, allowedAppIds: ['paint'], idleTimeoutMinutes: 10 },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });
    h.advanceMinutes(12);

    // The disabled driver throws if consulted, so a clean sweep also proves the
    // reaper never reaches for hardware that is not there.
    expect(await h.runtime.ctx.manager.reap()).toMatchObject({ ended: 1 });
    const row = await h.runtime.ctx.repos.sessions.byId(started.json().id);
    expect(row?.endReason).toBe('idle_timeout');
  });

  it('refuses a desktop activity clearly rather than failing obscurely', async () => {
    harness = await createHarness(ist('2026-03-14T10:00:00'), {
      DEPLOYMENT_MODE: 'lite',
    } as NodeJS.ProcessEnv);
    const h = harness;
    const { guardian, childId, kid } = await onboard(h, 'lite5@example.com', {
      displayName: 'Anaya',
      birthYear: 2011,
      birthMonth: 2,
      pin: '3333',
    });
    // Granted by the parent, but this deployment cannot serve it.
    await h.setPolicy(guardian, childId, {
      dailyMinutes: 60,
      allowedAppIds: ['thonny', 'paint'],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'thonny' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('desktop_unavailable');
    expect(res.json().error.message).toMatch(/big computer/i);

    // And the cheap path still works.
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe('Scenario: a child opens KidPC for the very first time', () => {
  it('flags the first run, then never again', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(h, 'firstrun@example.com', {
      displayName: 'Meera',
      birthYear: 2019,
      birthMonth: 4,
      pin: '1111',
    });

    const before = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(before.json().firstRun).toBe(true);

    await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });

    // Derived from sessions on record rather than a client-side flag, so it
    // survives a reload and cannot be re-triggered by clearing storage.
    const after = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(after.json().firstRun).toBe(false);
  });
});

describe('Scenario: progress', () => {
  it('keeps a personal best and never lets a bad round erase it', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'progress@example.com', {
      displayName: 'Meera',
      birthYear: 2019,
      birthMonth: 4,
      pin: '1111',
    });

    for (const value of [12, 30, 8]) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/progress',
        headers: asParent(kid),
        payload: { appId: 'numbers', metric: 'puzzles_solved', value },
      });
      expect(res.statusCode).toBe(200);
    }

    const mine = await h.app.inject({ method: 'GET', url: '/v1/progress', headers: asKid(kid) });
    const row = mine.json().progress.find((r: { appId: string }) => r.appId === 'numbers');
    expect(row).toMatchObject({ best: 30, latest: 8, attempts: 3 });

    // A parent sees the same figures on the dashboard.
    const usage = await h.app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/usage`,
      headers: { authorization: `Bearer ${guardian}` },
    });
    expect(usage.json().progress[0]).toMatchObject({ metric: 'puzzles_solved', best: 30 });
  });

  it('refuses a metric that is not in the closed vocabulary', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { kid } = await onboard(h, 'progress2@example.com', {
      displayName: 'Meera',
      birthYear: 2019,
      birthMonth: 4,
      pin: '1111',
    });

    // An open metric field would eventually carry a child's own words. It is a
    // closed enum precisely so that cannot happen by accident.
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/progress',
      headers: asParent(kid),
      payload: { appId: 'numbers', metric: 'favourite_colour', value: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Scenario: a parent putting something right', () => {
  it('resets limits to what suits the child now, not what they were set to', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'reset1@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });

    // Someone has talked a parent into four hours a day and every app.
    await h.setPolicy(guardian, childId, {
      dailyMinutes: 240,
      allowedAppIds: ['paint', 'typing', 'blocks', 'numbers', 'writer'],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(guardian),
      payload: { scope: 'limits' },
    });
    expect(res.statusCode).toBe(200);

    const home = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    expect(home.json().time.dailyMinutes).toBe(45); // the Builder default
  });

  it('sets a new code without touching anything else', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'reset2@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/progress',
      headers: asParent(kid),
      payload: { appId: 'numbers', metric: 'score', value: 99 },
    });

    await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(guardian),
      payload: { scope: 'pin', pin: '9876' },
    });

    await expect(h.childToken(guardian, childId, '2222')).rejects.toThrow();
    await expect(h.childToken(guardian, childId, '9876')).resolves.toBeTruthy();

    // Fixing a forgotten code must not cost a child their scores.
    const newKid = await h.childToken(guardian, childId, '9876');
    const progress = await h.app.inject({
      method: 'GET',
      url: '/v1/progress',
      headers: asKid(newKid),
    });
    expect(progress.json().progress).toHaveLength(1);
  });

  it('rejects a PIN reset with no new PIN rather than blanking it', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId } = await onboard(h, 'reset3@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(guardian),
      payload: { scope: 'pin' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears scores without touching screen-time history', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'reset4@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });
    h.advanceMinutes(10);
    await h.app.inject({
      method: 'POST',
      url: `/v1/sessions/${started.json().id}/heartbeat`,
      headers: asKid(kid),
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/progress',
      headers: asParent(kid),
      payload: { appId: 'paint', metric: 'score', value: 42 },
    });

    await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(guardian),
      payload: { scope: 'progress' },
    });

    const usage = await h.app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/usage`,
      headers: asParent(guardian),
    });
    expect(usage.json().progress).toHaveLength(0);
    // The minutes they actually used are a separate record and must survive.
    expect(usage.json().history.at(-1).minutes).toBe(10);
  });

  it('stops a session on the spot', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { guardian, childId, kid } = await onboard(h, 'reset5@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'paint' },
    });

    await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(guardian),
      payload: { scope: 'session' },
    });
    expect(await h.runtime.ctx.repos.sessions.liveForChild(childId)).toBeNull();
  });

  it("will not let one parent reset another household's child", async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const { childId } = await onboard(h, 'reset6@example.com', {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });
    const stranger = await h.registerGuardian('stranger@example.com');

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/reset`,
      headers: asParent(stranger),
      payload: { scope: 'limits' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a service that is live but cannot yet onboard a child', () => {
  /**
   * The state kidspc.online launches in. A parent can register and sign in, but
   * no child can be given an account until a real verifier exists. The point of
   * these tests is that the refusal is *structural* -- not a message on a
   * screen that a future refactor can route around.
   */
  const open = async () =>
    createHarness(ist('2026-03-14T10:00:00'), { CONSENT_VERIFIER: 'unavailable' });

  it('lets a parent register and sign in', async () => {
    harness = await open();
    const token = await harness.registerGuardian('live@example.com');
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: asParent(token),
    });
    expect(me.statusCode).toBe(200);
  });

  it('refuses to start a consent challenge, and says why', async () => {
    harness = await open();
    const token = await harness.registerGuardian('live2@example.com');
    const childId = await harness.createChild(token, {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });

    const res = await harness.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/consent/start`,
      headers: { ...asParent(token), 'content-type': 'application/json' },
      payload: { method: 'digilocker', scopes: ['account', 'progress'] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('consent_unavailable');
    // 503 would page an on-call engineer for a deliberate configuration.
    expect(res.statusCode).not.toBe(503);
  });

  it('creates no challenge row to clean up later', async () => {
    harness = await open();
    const token = await harness.registerGuardian('live3@example.com');
    const childId = await harness.createChild(token, {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });
    await harness.app.inject({
      method: 'POST',
      url: `/v1/children/${childId}/consent/start`,
      headers: { ...asParent(token), 'content-type': 'application/json' },
      payload: { method: 'digilocker', scopes: ['account'] },
    });

    // Fail-closed means refusing before any state is written, so that the day a
    // real verifier is configured there are no orphaned challenges in flight.
    const challenges = await harness.runtime.ctx.database.db
      .select()
      .from(consentChallenges)
      .where(eq(consentChallenges.childId, childId));
    expect(challenges).toHaveLength(0);
    expect(await harness.runtime.ctx.repos.consents.activeFor(childId)).toBeNull();
  });

  it('refuses the child a token at all, which is stronger than refusing a session', async () => {
    harness = await open();
    const token = await harness.registerGuardian('live4@example.com');
    const childId = await harness.createChild(token, {
      displayName: 'Ravi',
      birthYear: 2015,
      birthMonth: 9,
      pin: '2222',
    });

    // The correct PIN, and still refused. The gate is on consent, not on the
    // session route -- so a child never holds a credential in the first place
    // and there is no authorised surface left to get wrong.
    const login = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/child/login',
      headers: { ...asParent(token), 'content-type': 'application/json' },
      payload: { childId, pin: '2222' },
    });

    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('consent_required');
    expect(login.json().accessToken).toBeUndefined();
  });

  it('reports the state on /healthz rather than only in the env file', async () => {
    harness = await open();
    const res = await harness.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json().consent).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a household asking to subscribe', () => {
  const post = (h: Harness, body: unknown, token?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: token
        ? { ...asParent(token), 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
      payload: body as object,
    });

  it('takes a request from someone with no account, and quotes the price itself', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, { email: 'parent@example.com', planId: 'lite', children: 3 });

    expect(res.statusCode).toBe(201);
    // 299 base + 150 for the third child. Priced from the plan table, not from
    // anything the client sent.
    expect(res.json().quotedInr).toBe(449);
    expect(res.json().orderId).toMatch(/^ord_/);
  });

  it('ignores a price the client tries to name', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, {
      email: 'cheeky@example.com',
      planId: 'pro',
      children: 4,
      quotedInr: 1,
      status: 'paid',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().quotedInr).toBe(1998);
  });

  it('queues a confirmation to the household', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await post(h, { email: 'queued@example.com', planId: 'lite', children: 1 });

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const confirmation = queued.find((m) => m.template === 'order_received');
    expect(confirmation).toBeTruthy();
    expect(confirmation!.toAddress).toBe('queued@example.com');
    expect(confirmation!.sentAt).toBeNull();
    // The promise the page makes must be the promise the email keeps.
    expect(confirmation!.bodyText).toContain('payment link');
    expect(confirmation!.bodyText).toContain('₹299');
  });

  it('never asks for or stores a payment detail', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, {
      email: 'card@example.com',
      planId: 'lite',
      children: 1,
      cardNumber: '4111111111111111',
    });
    expect(res.statusCode).toBe(201);

    const orders = await h.runtime.ctx.database.db.select().from(planOrders);
    // Zod strips what it does not declare; this asserts the row cannot carry a
    // card even if a form someday sends one.
    expect(JSON.stringify(orders)).not.toContain('4111');
  });

  it('refuses a household larger than the form supports, rather than guessing', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    // 400 is this service's answer to a malformed request; the point of the
    // test is that each of these is refused rather than guessed at.
    expect((await post(h, { email: 'big@example.com', planId: 'lite', children: 9 })).statusCode).toBe(400);
    expect((await post(h, { email: 'none@example.com', planId: 'lite', children: 0 })).statusCode).toBe(400);
    expect((await post(h, { email: 'nope@example.com', planId: 'gold', children: 1 })).statusCode).toBe(400);
    expect((await post(h, { email: 'not-an-email', planId: 'lite', children: 1 })).statusCode).toBe(400);
  });

  it('links the request to a guardian when one is signed in', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const token = await h.registerGuardian('linked@example.com');
    const res = await post(h, { email: 'linked@example.com', planId: 'pro', children: 2 }, token);

    const orderId = res.json().orderId as string;
    const mine = await h.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: asParent(token),
    });
    expect(mine.json().order.quotedInr).toBe(999);

    // Another guardian cannot read it, and is not told it exists.
    const stranger = await h.registerGuardian('stranger-order@example.com');
    const theirs = await h.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: asParent(stranger),
    });
    expect(theirs.json().order).toBeNull();
  });
});

describe('Scenario: one parent sending another', () => {
  const post = (h: Harness, body: unknown) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: { 'content-type': 'application/json' },
      payload: body as object,
    });

  it('remembers who sent them and gives them the longer trial', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    // Typed the way it arrives off a WhatsApp message: lower case, and with a
    // letter O where the code has a zero.
    const res = await post(h, {
      email: 'sent@example.com',
      planId: 'lite',
      children: 2,
      referralCode: 'kpc-o11abc',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().referred).toBe(true);
    expect(res.json().trialDays).toBe(TRIAL_DAYS + REFERRAL_BONUS_DAYS);

    const [order] = await h.runtime.ctx.database.db.select().from(planOrders);
    expect(order!.referralCode).toBe('KPC-011ABC');
    // Nobody has been paid anything yet, and nothing here can do that.
    expect(order!.referralRewardedAt).toBeNull();
  });

  it('takes the order anyway when the code is nonsense', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, {
      email: 'typo@example.com',
      planId: 'lite',
      children: 1,
      referralCode: 'my friend told me',
    });

    // A mistyped code must never be the reason somebody cannot buy. It is
    // dropped, the trial is the ordinary one, and the sale goes through.
    expect(res.statusCode).toBe(201);
    expect(res.json().referred).toBe(false);
    expect(res.json().trialDays).toBe(TRIAL_DAYS);
    const [order] = await h.runtime.ctx.database.db.select().from(planOrders);
    expect(order!.referralCode).toBeNull();
  });

  it('will not conjure a trial on a plan that has none', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, {
      email: 'pro-referred@example.com',
      planId: 'pro',
      children: 2,
      referralCode: referralCodeFor('gdn_someone'),
    });

    // Pro streams a Linux desktop on hardware we pay for by the hour. A code
    // pasted into the form must not be able to hand out a free fortnight of it.
    expect(res.statusCode).toBe(201);
    expect(res.json().referred).toBe(true);
    expect(res.json().trialDays).toBe(0);
    expect(trialDaysFor(planById('pro'), { referred: true })).toBe(0);

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const confirmation = queued.find((m) => m.template === 'order_received');
    expect(confirmation!.bodyText).toContain('does not come with a free trial');
    expect(confirmation!.bodyText).not.toMatch(/days are free/);
  });

  it('promises the longer trial in the email as well as on the page', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await post(h, {
      email: 'invited@example.com',
      planId: 'lite',
      children: 2,
      referralCode: referralCodeFor('gdn_someone'),
    });

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const confirmation = queued.find((m) => m.template === 'order_received');
    // The page said fourteen days. An email that says seven is worse than an
    // email that says nothing.
    expect(confirmation!.bodyText).toContain(`${TRIAL_DAYS + REFERRAL_BONUS_DAYS} days are free`);
    expect(confirmation!.bodyText).toContain('Someone sent you here');
  });

  it('tells whoever sends the payment link whose month to credit', async () => {
    // The internal notice only exists where there is a desk to send it to.
    const h = await open(ist('2026-03-14T10:00:00'), { ORDERS_EMAIL: 'desk@example.com' });
    const code = referralCodeFor('gdn_referrer');
    await post(h, {
      email: 'credit@example.com',
      planId: 'pro',
      children: 2,
      referralCode: code,
    });

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const internal = queued.find((m) => m.template === 'order_internal');
    expect(internal!.bodyText).toContain(code);
    // And says the one thing that stops a reward being given out too early.
    expect(internal!.bodyText).toContain('only after they pay');
  });
});

describe('Scenario: somebody writing in', () => {
  const post = (h: Harness, body: unknown) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/contact',
      headers: { 'content-type': 'application/json' },
      payload: body as object,
    });

  it('sends the message on and tells the sender it arrived', async () => {
    const h = await open(ist('2026-03-14T10:00:00'), { ORDERS_EMAIL: 'desk@example.com' });
    const res = await post(h, {
      name: 'Priya',
      email: 'priya@example.com',
      message: 'My daughter cannot get into her profile and it says she needs approval.',
    });

    expect(res.statusCode).toBe(202);

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const toDesk = queued.find((m) => m.toAddress === 'desk@example.com');
    const toSender = queued.find((m) => m.toAddress === 'priya@example.com');

    expect(toDesk!.bodyText).toContain('priya@example.com');
    expect(toDesk!.bodyText).toContain('cannot get into her profile');
    // Whoever answers must reply to Priya, not to the service's own mailbox.
    expect(toDesk!.bodyText).toContain('Reply to that address');
    // And Priya gets her own words back, so she is not left wondering.
    expect(toSender!.bodyText).toContain('cannot get into her profile');
  });

  it('still acknowledges when there is nowhere to forward it', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    const res = await post(h, {
      name: 'Arjun',
      email: 'arjun@example.com',
      message: 'Does this work on a Samsung television from 2019?',
    });

    // The outbox is durable, so a deployment whose mailbox is configured later
    // sends this on its first sweep rather than having lost it.
    expect(res.statusCode).toBe(202);
    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    expect(queued.find((m) => m.toAddress === 'arjun@example.com')).toBeTruthy();
  });

  it('refuses what is not a message', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    expect((await post(h, { name: 'A', email: 'not-an-email', message: 'hello there' })).statusCode).toBe(400);
    expect((await post(h, { name: 'A', email: 'a@example.com', message: 'hi' })).statusCode).toBe(400);
    expect((await post(h, { name: '', email: 'a@example.com', message: 'hello there' })).statusCode).toBe(400);
  });

  it('keeps no record of a stranger beyond the mail it has to send', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await post(h, {
      name: 'Nobody',
      email: 'nobody@example.com',
      message: 'Just asking a question, I have no account.',
    });

    // No account, no order, no support ticket. A table that accumulates
    // unread messages from strangers is a liability with no owner.
    const guardians = await h.runtime.ctx.database.db.select().from(planOrders);
    expect(guardians).toHaveLength(0);
  });
});

describe('Scenario: the email a parent actually receives', () => {
  it('queues a welcome the moment an account is created', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('welcome@example.com');

    const queued = await h.runtime.ctx.database.db.select().from(emailOutbox);
    const welcome = queued.find((m) => m.template === 'welcome');
    expect(welcome).toBeTruthy();
    expect(welcome!.toAddress).toBe('welcome@example.com');
    // Says the thing that is true and awkward, rather than only the nice parts.
    expect(welcome!.bodyText).toContain('verify that you are their parent');
  });

  it('sends nothing twice, and marks what it sent', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('once@example.com');

    const sent: string[] = [];
    const mailer = { name: 'log' as const, send: async (m: { to: string }) => void sent.push(m.to) };

    const first = await sendPending(h.runtime.ctx.database.db, mailer, h.now);
    const second = await sendPending(h.runtime.ctx.database.db, mailer, h.now);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sent).toEqual(['once@example.com']);
  });

  it('keeps a failed message and backs off instead of dropping or spinning', async () => {
    const h = await open(ist('2026-03-14T10:00:00'));
    await h.registerGuardian('fails@example.com');

    const failing = {
      name: 'log' as const,
      send: async () => {
        throw new Error('550 mailbox unavailable');
      },
    };
    const result = await sendPending(h.runtime.ctx.database.db, failing, h.now);
    expect(result).toEqual({ sent: 0, failed: 1 });

    const [row] = await h.runtime.ctx.database.db.select().from(emailOutbox);
    // Still queued, with the reason recorded and the next attempt pushed out.
    expect(row!.sentAt).toBeNull();
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toContain('550');
    expect(row!.nextTryAt.getTime()).toBeGreaterThan(h.now().getTime());

    // And it is not retried until that time arrives.
    expect((await sendPending(h.runtime.ctx.database.db, failing, h.now)).failed).toBe(0);
  });

  it('backs off further each time, then settles rather than growing forever', async () => {
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(1)).toBe(5);
    expect(backoffMinutes(4)).toBe(1440);
    // A mailbox that does not exist should be retried daily and kept, not
    // hammered and not silently discarded.
    expect(backoffMinutes(99)).toBe(1440);
  });
});
