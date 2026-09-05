import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createRuntime, type Runtime } from './boot.js';

/**
 * End-to-end through the real HTTP surface: the same app object `index.ts`
 * serves, backed by an in-memory PGlite database and the loopback desktop
 * driver. These tests are the ones that would catch a wiring mistake between
 * the policy engine, the broker and the routes.
 */
const ENV = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  CONSENT_VERIFIER: 'mock',
  SESSION_DRIVER: 'loopback',
  LOG_LEVEL: 'silent',
  // These tests drive every route from one address; per-IP limits would trip on
  // the fixtures rather than on anything real. Limiting is covered on its own
  // below, with a second app that leaves it switched on.
  RATE_LIMITS: 'off',
} as unknown as NodeJS.ProcessEnv;

let app: FastifyInstance;
let runtime: Runtime;
let clock = new Date('2026-03-11T10:30:00Z'); // 16:00 IST, a Wednesday

beforeAll(async () => {
  runtime = await createRuntime(ENV, { now: () => clock });
  app = await buildApp(runtime.ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await runtime.shutdown();
});

const advanceMinutes = (n: number) => {
  clock = new Date(clock.getTime() + n * 60_000);
};

async function registerGuardian(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password: 'a-long-enough-password', displayName: 'Parent' },
  });
  expect(res.statusCode).toBe(201);
  return {
    token: res.json().accessToken as string,
    cookie: res.cookies.find((c) => c.name === 'kidpc_rt')!,
  };
}

async function createChild(token: string, over: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/children',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      displayName: 'Ananya',
      birthYear: 2016,
      birthMonth: 1,
      avatarId: 'fox',
      pin: '4321',
      ...over,
    },
  });
  return res;
}

/** Run the mock consent flow to completion. */
async function grantConsent(token: string, childId: string) {
  const started = await app.inject({
    method: 'POST',
    url: `/v1/children/${childId}/consent/start`,
    headers: { authorization: `Bearer ${token}` },
    payload: { method: 'dev_mock', scopes: ['account', 'progress'] },
  });
  expect(started.statusCode).toBe(200);
  const { challengeId, devHint } = started.json();

  const done = await app.inject({
    method: 'POST',
    url: `/v1/children/${childId}/consent/complete`,
    headers: { authorization: `Bearer ${token}` },
    payload: { challengeId, proof: devHint },
  });
  expect(done.statusCode).toBe(200);
}

async function childToken(token: string, childId: string, pin = '4321') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/child/login',
    headers: { authorization: `Bearer ${token}` },
    payload: { childId, pin },
  });
  return res;
}

describe('health', () => {
  it('reports the settings most often wrong after a deploy', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({
      ok: true,
      driver: 'loopback',
      appsOrigin: 'https://apps.kidspc.online',
    });
  });
});

describe('guardian onboarding', () => {
  it('registers, rejects a duplicate email, and signs in', async () => {
    const { token } = await registerGuardian('parent1@example.com');
    expect(token).toBeTruthy();

    const dup = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'PARENT1@example.com',
        password: 'a-long-enough-password',
        displayName: 'Someone else',
      },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('email_taken');

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'parent1@example.com', password: 'a-long-enough-password' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'parent1@example.com', password: 'not-the-password' },
    });
    const noSuchAccount = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'not-the-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchAccount.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchAccount.json());
  });

  it('rotates the refresh token on every use', async () => {
    const { cookie } = await registerGuardian('rotate@example.com');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kidpc_rt: cookie.value },
    });
    expect(first.statusCode).toBe(200);

    // The original cookie must not work a second time.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { kidpc_rt: cookie.value },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('refuses anonymous access to the household', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
  });
});

describe('child profiles', () => {
  it('creates a profile with a conservative default policy', async () => {
    const { token } = await registerGuardian('parent2@example.com');
    const res = await createChild(token);
    expect(res.statusCode).toBe(201);

    const child = res.json();
    expect(child.band).toBe('builder'); // born Jan 2016, so 10 in March 2026
    expect(child.consentGranted).toBe(false);
    expect(child.policy.dailyMinutes).toBe(45);
    expect(child.policy.allowedAppIds).toContain('scratch');
    // Coder-band apps are not offered to a Builder.
    expect(child.policy.allowedAppIds).not.toContain('thonny');
  });

  it('refuses a child below the supported age', async () => {
    const { token } = await registerGuardian('parent3@example.com');
    const res = await createChild(token, { birthYear: 2024, birthMonth: 6 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.birthYear).toMatch(/aged 5 and up/);
  });

  it("will not let one guardian read another's child", async () => {
    const a = await registerGuardian('parent4@example.com');
    const b = await registerGuardian('parent5@example.com');
    const child = (await createChild(a.token)).json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/children/${child.id}`,
      headers: { authorization: `Bearer ${b.token}` },
      payload: { displayName: 'Renamed' },
    });
    // 404 rather than 403: guardian B should not learn that this id exists.
    expect(res.statusCode).toBe(404);
  });
});

describe('consent gate', () => {
  it('blocks child sign-in until consent is verified, then allows it', async () => {
    const { token } = await registerGuardian('parent6@example.com');
    const child = (await createChild(token)).json();

    const before = await childToken(token, child.id);
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe('consent_required');

    await grantConsent(token, child.id);

    const after = await childToken(token, child.id);
    expect(after.statusCode).toBe(200);
    expect(after.json().accessToken).toBeTruthy();
  });

  it('rejects a bad proof and will not reuse a challenge', async () => {
    const { token } = await registerGuardian('parent7@example.com');
    const child = (await createChild(token)).json();

    const started = await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/consent/start`,
      headers: { authorization: `Bearer ${token}` },
      payload: { method: 'dev_mock', scopes: ['account'] },
    });
    const { challengeId } = started.json();

    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/consent/complete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { challengeId, proof: 'WRONG!' },
    });
    expect(wrong.statusCode).toBe(403);

    // The challenge was consumed by the failed attempt; it cannot be retried.
    const replay = await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/consent/complete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { challengeId, proof: 'ANYTHING' },
    });
    expect(replay.statusCode).toBe(400);
  });

  it('ends the live session when consent is revoked', async () => {
    const { token } = await registerGuardian('parent8@example.com');
    const child = (await createChild(token)).json();
    await grantConsent(token, child.id);
    const kid = (await childToken(token, child.id)).json().accessToken;

    const started = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${kid}` },
      payload: {},
    });
    expect(started.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: `/v1/children/${child.id}/consent/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    const current = await app.inject({
      method: 'GET',
      url: '/v1/sessions/current',
      headers: { authorization: `Bearer ${kid}` },
    });
    expect(current.json()).toBeNull();
  });
});

describe('a child at the screen', () => {
  let guardianToken: string;
  let childId: string;
  let kidToken: string;

  beforeAll(async () => {
    const { token } = await registerGuardian('parent9@example.com');
    guardianToken = token;
    childId = (await createChild(token)).json().id;
    await grantConsent(token, childId);
    kidToken = (await childToken(token, childId)).json().accessToken;
  });

  const asKid = () => ({ authorization: `Bearer ${kidToken}` });

  it('renders the launcher in a single call', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/home', headers: asKid() });
    expect(res.statusCode).toBe(200);

    const home = res.json();
    expect(home.child.displayName).toBe('Ananya');
    expect(home.child.band).toBe('builder');
    expect(home.apps.map((a: { id: string }) => a.id)).toContain('scratch');
    expect(home.apps.map((a: { id: string }) => a.id)).not.toContain('thonny');
    expect(home.time).toEqual({
      dailyMinutes: 45,
      usedTodayMinutes: 0,
      remainingMinutes: 45,
    });
    expect(home.canStart).toBe(true);
    expect(home.session).toBeNull();
  });

  it('starts a session and never leaks the desktop endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asKid(),
      payload: { appId: 'scratch', deviceKind: 'tv' },
    });
    expect(res.statusCode).toBe(201);

    const view = res.json();
    expect(view.state).toBe('ready');
    expect(view.remainingMinutes).toBe(45);
    expect(view.autoLaunchAppId).toBe('scratch');
    expect(view.streamPath).toBe(`/stream/${view.id}`);
    // Nothing about where the desktop actually lives may cross the wire.
    expect(Object.keys(view)).not.toContain('endpointHost');
    expect(JSON.stringify(view)).not.toMatch(/endpoint|secret|127\.0\.0\.1/i);
  });

  it('refuses to start an app above the child band', async () => {
    // A live session would be resumed rather than re-evaluated, so clear it
    // first: this test is about the gate, not about resumption.
    const current = await app.inject({
      method: 'GET',
      url: '/v1/sessions/current',
      headers: asKid(),
    });
    await app.inject({
      method: 'POST',
      url: `/v1/sessions/${current.json().id}/end`,
      headers: asKid(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asKid(),
      payload: { appId: 'thonny' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('band_too_low');
    expect(res.json().error.message).toMatch(/older/i);

    // Denied before anything was provisioned: the child can still start normally.
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asKid(),
      payload: { appId: 'scratch' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('bills time on heartbeat and counts it against today', async () => {
    const current = await app.inject({
      method: 'GET',
      url: '/v1/sessions/current',
      headers: asKid(),
    });
    const sessionId = current.json().id;

    advanceMinutes(20);
    const beat = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/heartbeat`,
      headers: asKid(),
    });
    expect(beat.statusCode).toBe(200);
    expect(beat.json().state).toBe('active');
    expect(beat.json().remainingMinutes).toBe(25);

    const home = await app.inject({ method: 'GET', url: '/v1/home', headers: asKid() });
    expect(home.json().time).toEqual({
      dailyMinutes: 45,
      usedTodayMinutes: 20,
      remainingMinutes: 25,
    });
  });

  it('issues a stream ticket bound to the session', async () => {
    const current = await app.inject({
      method: 'GET',
      url: '/v1/sessions/current',
      headers: asKid(),
    });
    const sessionId = current.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/ticket`,
      headers: asKid(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().expiresInSeconds).toBe(30);
    expect(res.json().path).toBe(`/stream/${sessionId}`);
  });

  it('ends the day when the budget runs out', async () => {
    const current = await app.inject({
      method: 'GET',
      url: '/v1/sessions/current',
      headers: asKid(),
    });
    const sessionId = current.json().id;

    advanceMinutes(30); // past the 45-minute grant
    const beat = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/heartbeat`,
      headers: asKid(),
    });
    expect(beat.json().state).toBe('terminated');

    const home = await app.inject({ method: 'GET', url: '/v1/home', headers: asKid() });
    expect(home.json().canStart).toBe(false);
    expect(home.json().blocked.reason).toBe('daily_budget_exhausted');
    expect(home.json().blocked.message).toMatch(/see you tomorrow/i);
    expect(home.json().blocked.retryAt).toBe('2026-03-11T18:30:00.000Z'); // IST midnight

    const retry = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: asKid(),
      payload: {},
    });
    expect(retry.statusCode).toBe(403);
    expect(retry.json().error.code).toBe('daily_budget_exhausted');
  });

  it('lets a parent tighten the policy and see the usage history', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/v1/children/${childId}/policy`,
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: {
        dailyMinutes: 30,
        weeklyMinutes: 180,
        allowedWindows: [{ days: [1, 2, 3, 4, 5], start: '16:00', end: '18:30' }],
        // A parent trying to grant a Coder app to a Builder is quietly dropped.
        allowedAppIds: ['scratch', 'tuxpaint', 'thonny'],
        sessionSummaries: false,
        idleTimeoutMinutes: 10,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().allowedAppIds).toEqual(['scratch', 'tuxpaint']);

    const usage = await app.inject({
      method: 'GET',
      url: `/v1/children/${childId}/usage`,
      headers: { authorization: `Bearer ${guardianToken}` },
    });
    const body = usage.json();
    expect(body.history).toHaveLength(14);
    expect(body.history.at(-1).dayKey).toBe('2026-03-11');

    // The invariant that matters: the day's ledger is exactly the sum of what
    // the individual sessions were billed. If those two ever drift, a child is
    // being charged for time they did not get, or getting time for free.
    const today = body.history.at(-1).minutes;
    const billed = body.sessions
      .filter((s: { startedAt: string }) => s.startedAt.startsWith('2026-03-11'))
      .reduce((sum: number, s: { minutes: number }) => sum + s.minutes, 0);
    expect(today).toBe(billed);
    expect(today).toBeGreaterThan(0);

    expect(body.sessions.map((s: { endReason: string }) => s.endReason)).toContain(
      'budget_exhausted',
    );
  });

  it('will not let a child act on a session that is not theirs', async () => {
    const other = await registerGuardian('parent10@example.com');
    const otherChild = (await createChild(other.token)).json();
    await grantConsent(other.token, otherChild.id);
    const otherKid = (await childToken(other.token, otherChild.id)).json().accessToken;

    const started = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${otherKid}` },
      payload: {},
    });
    const foreignSessionId = started.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${foreignSessionId}/heartbeat`,
      headers: asKid(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a guardian token on child routes and vice versa', async () => {
    const asGuardian = await app.inject({
      method: 'GET',
      url: '/v1/home',
      headers: { authorization: `Bearer ${guardianToken}` },
    });
    expect(asGuardian.statusCode).toBe(401);

    const asChild = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: asKid(),
    });
    expect(asChild.statusCode).toBe(401);
  });
});

describe('data rights', () => {
  it('exports the household and erases it on request', async () => {
    const { token } = await registerGuardian('erase@example.com');
    const child = (await createChild(token)).json();
    await grantConsent(token, child.id);

    const exported = await app.inject({
      method: 'GET',
      url: '/v1/privacy/export',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().children).toHaveLength(1);
    expect(exported.json().children[0].profile.displayName).toBe('Ananya');

    const erased = await app.inject({
      method: 'POST',
      url: '/v1/privacy/erase',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(erased.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('locks out repeated password guessing', async () => {
    const limited = await createRuntime(
      { ...ENV, RATE_LIMITS: 'on' } as unknown as NodeJS.ProcessEnv,
      { now: () => clock },
    );
    const limitedApp = await buildApp(limited.ctx);
    await limitedApp.ready();

    try {
      await limitedApp.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: 'target@example.com',
          password: 'a-long-enough-password',
          displayName: 'Parent',
        },
      });

      const codes: number[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        const res = await limitedApp.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: 'target@example.com', password: `guess-${attempt}` },
        });
        codes.push(res.statusCode);
      }

      // The login route allows 10 tries per 15 minutes; the rest are refused
      // before the password is ever checked.
      expect(codes.filter((c) => c === 401)).toHaveLength(10);
      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    } finally {
      await limitedApp.close();
      await limited.shutdown();
    }
  });
});

describe('egress policy (control plane for the proxy)', () => {
  async function liveSession() {
    const { token } = await registerGuardian(`egress-${Date.now()}@example.com`);
    const child = (await createChild(token)).json();
    await grantConsent(token, child.id);
    const kid = (await childToken(token, child.id)).json().accessToken;
    const started = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${kid}` },
      payload: {},
    });
    const session = await runtime.ctx.repos.sessions.byId(started.json().id);
    return { guardianToken: token, childId: child.id, session: session! };
  }

  it('returns only the origins the granted apps declare', async () => {
    const { session } = await liveSession();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: session.id, secret: session.endpointSecret },
    });
    expect(res.statusCode).toBe(200);
    // A Builder with the default grant includes the research app, so the
    // encyclopaedia origins are open -- and nothing else is.
    expect(res.json().origins).toContain('https://kids.britannica.com');
    expect(res.json().origins).not.toContain('https://www.youtube.com');
  });

  it('closes origins as soon as the parent switches the app off', async () => {
    const { guardianToken, childId, session } = await liveSession();

    await app.inject({
      method: 'PUT',
      url: `/v1/children/${childId}/policy`,
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: {
        dailyMinutes: 45,
        weeklyMinutes: null,
        allowedWindows: [],
        allowedAppIds: ['tuxpaint', 'scratch'], // research revoked
        sessionSummaries: false,
        idleTimeoutMinutes: 12,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: session.id, secret: session.endpointSecret },
    });
    // The answer follows current policy, not a snapshot taken at session start,
    // so revoking an app closes its origins without restarting the desktop.
    expect(res.json().origins).not.toContain('https://kids.britannica.com');
    expect(res.json().origins).toEqual(['https://apps.kidspc.online']);
  });

  it('refuses a wrong secret, an unknown session, and an ended one', async () => {
    const { session } = await liveSession();

    const wrongSecret = await app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: session.id, secret: 'not-the-secret' },
    });
    expect(wrongSecret.statusCode).toBe(403);

    const unknown = await app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: 'ses_nope', secret: 'anything' },
    });
    expect(unknown.statusCode).toBe(403);

    await runtime.ctx.manager.endById(session.id, 'child_ended');
    const ended = await app.inject({
      method: 'POST',
      url: '/internal/egress/policy',
      payload: { sessionId: session.id, secret: session.endpointSecret },
    });
    // A terminated session must not keep a working route to the internet.
    expect(ended.statusCode).toBe(403);
  });
});
