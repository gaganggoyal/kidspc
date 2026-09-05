import { afterEach, describe, expect, it } from 'vitest';
import { type Harness, createHarness, ist, onboard } from './testing/harness.js';

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

async function open(startAt: Date): Promise<Harness> {
  harness = await createHarness(startAt);
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
    allowedAppIds: ['scratch', 'tuxpaint', 'tuxtype'],
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
      payload: { appId: 'tuxpaint' },
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
      { dailyMinutes: 60, allowedAppIds: ['tuxpaint'], idleTimeoutMinutes: 10 },
    );

    const started = await h.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asParent(kid),
      payload: { appId: 'tuxpaint' },
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
      { dailyMinutes: 60, allowedAppIds: ['scratch', 'tuxpaint'] },
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
      allowedAppIds: ['tuxpaint'],
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
    expect(home.json().apps.map((a: { id: string }) => a.id)).toEqual(['tuxpaint']);
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
      allowedAppIds: ['tuxpaint', 'gcompris', 'blockly-puzzles'],
    });

    h.setClock(ist('2026-06-10T10:00:00'));
    const after = await h.app.inject({ method: 'GET', url: '/v1/home', headers: asKid(kid) });
    const ids = after.json().apps.map((a: { id: string }) => a.id);

    expect(ids).toContain('scratch'); // newly unlocked by the band change
    expect(ids).not.toContain('tuxtype'); // a decision the parent already made
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
