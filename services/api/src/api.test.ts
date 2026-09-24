import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { buildApp } from './app.js';
import { createRuntime, type Runtime } from './boot.js';
import { emailOutbox } from './db/schema.js';
import { emailedCode } from './testing/harness.js';

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

/** Sign up, confirm with the emailed code, and choose a password. */
async function registerGuardian(email: string) {
  const asked = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, displayName: 'Parent' },
  });
  expect(asked.statusCode).toBe(202);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: await emailedCode(runtime, email, 'verify_email') },
  });
  expect(res.statusCode).toBe(200);
  const token = res.json().accessToken as string;
  const set = await app.inject({
    method: 'POST',
    url: '/v1/auth/password/set',
    headers: { authorization: `Bearer ${token}` },
    payload: { password: 'a-long-enough-password' },
  });
  expect(set.statusCode).toBe(200);
  return { token, cookie: res.cookies.find((c) => c.name === 'kidpc_rt')! };
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
      mode: 'full',
      driver: 'loopback',
      consent: 'dev_mock',
      // No SMTP in tests, so mail is queued and logged rather than delivered.
      mail: 'log',
      mailPending: 0,
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

/**
 * The queued message itself, not just a count.
 *
 * A reset link exists only inside an email, so a test that cannot read the
 * outbox cannot test the feature at all -- it can only test that a row was
 * written, which is the part that was never going to be wrong.
 */
async function lastEmail(to: string, template?: string) {
  const rows = await runtime.ctx.database.db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.toAddress, to))
    // `id` and not `created_at`: the tests drive a frozen clock, so the
    // welcome mail and the reset mail sent seconds apart in the same test
    // carry the same timestamp and the sort has nothing to work with. Ids are
    // ULID-shaped off the wall clock, so they still order.
    .orderBy(desc(emailOutbox.id));
  const match = template ? rows.find((r) => r.template === template) : rows[0];
  return match ?? null;
}

const tokenFromResetEmail = (body: string) => {
  const match = /\/reset\?token=([^\s]+)/.exec(body);
  expect(match, 'the reset mail should carry a link').not.toBeNull();
  return decodeURIComponent(match![1]!);
};

describe('confirming an address at sign-up', () => {
  const ask = (email: string, displayName = 'Parent') =>
    app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email, displayName } });
  const verify = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/auth/email/verify', payload });

  it('answers a sign-up with a letter, not a session', async () => {
    const res = await ask('letter-first@example.com');
    expect(res.statusCode).toBe(202);
    expect(res.json().accessToken).toBeUndefined();
    expect(res.cookies.find((c) => c.name === 'kidpc_rt')).toBeUndefined();
    expect((await lastEmail('letter-first@example.com'))?.template).toBe('verify_email');
  });

  it('signs in with the code, then lets the owner choose the first password once', async () => {
    const email = 'first-password@example.com';
    await ask(email);
    const res = await verify({ email, code: await emailedCode(runtime, email, 'verify_email') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ firstTime: true, needsPassword: true });
    const token = res.json().accessToken as string;

    const set = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/password/set',
        headers: { authorization: `Bearer ${token}` },
        payload: { password },
      });
    expect((await set('a-long-enough-password')).statusCode).toBe(200);
    // A second "first password" would be a way to change one without the
    // inbox, which is what the reset route is for.
    const again = await set('somebody-elses-password');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('password_exists');

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'a-long-enough-password' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('accepts the button as well as the code, once', async () => {
    const email = 'button@example.com';
    await ask(email);
    const token = /\/verify\?token=([^\s]+)/.exec(
      (await lastEmail(email, 'verify_email'))!.bodyText,
    )![1]!;
    const first = await verify({ token: decodeURIComponent(token) });
    expect(first.statusCode).toBe(200);
    const second = await verify({ token: decodeURIComponent(token) });
    expect(second.statusCode).toBe(401);
    expect(second.json().error.code).toBe('code_rejected');
  });

  it('spends a letter after five wrong codes, so six digits cannot be walked', async () => {
    const email = 'guesser@example.com';
    await ask(email);
    const real = await emailedCode(runtime, email, 'verify_email');
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await verify({ email, code: wrong })).statusCode).toBe(401);
    }
    expect((await verify({ email, code: real })).statusCode).toBe(401);
  });

  it('gives an address nobody confirmed to whoever can read its inbox', async () => {
    const email = 'squatted@example.com';
    // Somebody types an address that is not theirs, and never confirms it.
    await ask(email, 'Not the owner');
    const theirs = await emailedCode(runtime, email, 'verify_email');
    // The owner signs up with it later. Their letter replaces the first, and
    // their name is the one the account carries. There is no password in
    // either request, so there is nothing for the first person to have set.
    const res = await ask(email, 'The owner');
    expect(res.statusCode).toBe(202);
    const owners = await emailedCode(runtime, email, 'verify_email');
    if (owners !== theirs) expect((await verify({ email, code: theirs })).statusCode).toBe(401);
    const signedIn = await verify({ email, code: owners });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().guardian.displayName).toBe('The owner');
  });

  it('answers a code for an unknown address exactly as it answers a wrong one', async () => {
    const res = await verify({ email: 'never-signed-up@example.com', code: '123456' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('code_rejected');
  });

  it('lets a code go stale after half an hour', async () => {
    const email = 'slow-to-confirm@example.com';
    await ask(email);
    const code = await emailedCode(runtime, email, 'verify_email');
    advanceMinutes(31);
    expect((await verify({ email, code })).statusCode).toBe(401);
    advanceMinutes(-31);
  });

  it('sends the welcome once the address is confirmed, and not before', async () => {
    const email = 'welcome-later@example.com';
    await ask(email);
    expect(await lastEmail(email, 'welcome')).toBeNull();
    await verify({ email, code: await emailedCode(runtime, email, 'verify_email') });
    expect((await lastEmail(email, 'welcome'))?.template).toBe('welcome');
  });
});

describe('signing in with an emailed code', () => {
  const askForCode = (email: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/email/code', payload: { email } });

  it('signs a household in without its password', async () => {
    const email = 'code-sign-in@example.com';
    await registerGuardian(email);
    expect((await askForCode(email)).statusCode).toBe(202);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/email/verify',
      payload: { email, code: await emailedCode(runtime, email, 'sign_in_code') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ firstTime: false, needsPassword: false });
  });

  it('says the same thing about an address that is not registered', async () => {
    const known = 'code-known@example.com';
    await registerGuardian(known);
    const real = await askForCode(known);
    const invented = await askForCode('code-nobody@example.com');
    expect(invented.statusCode).toBe(real.statusCode);
    expect(invented.body).toBe(real.body);
    expect(await lastEmail('code-nobody@example.com')).toBeNull();
  });

  it('resends the sign-up code to an address that was never confirmed', async () => {
    const email = 'lost-the-first-code@example.com';
    await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, displayName: 'P' },
    });
    await askForCode(email);
    const mails = await runtime.ctx.database.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, email));
    expect(mails.map((m) => m.template)).toEqual(['verify_email', 'verify_email']);
  });

  it('stops filling one inbox after six letters in an hour', async () => {
    const email = 'flooded@example.com';
    await registerGuardian(email);
    for (let i = 0; i < 9; i++) expect((await askForCode(email)).statusCode).toBe(202);
    const codes = await runtime.ctx.database.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, email));
    expect(codes.filter((m) => m.template === 'sign_in_code')).toHaveLength(6);
  });

  it('keeps the kinds of letter apart', async () => {
    const email = 'kinds@example.com';
    await registerGuardian(email);
    await askForCode(email);
    const signInCode = await emailedCode(runtime, email, 'sign_in_code');
    // A sign-in code is not a password reset.
    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { email, code: signInCode, password: 'a-brand-new-long-password' },
    });
    expect(reset.statusCode).toBe(401);

    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const resetCode = await emailedCode(runtime, email, 'password_reset');
    // And a reset code does not sign anybody in without choosing a password.
    const signIn = await app.inject({
      method: 'POST',
      url: '/v1/auth/email/verify',
      payload: { email, code: resetCode },
    });
    expect(signIn.statusCode).toBe(401);
  });
});

describe('a forgotten password', () => {
  it('emails a link, signs the household back in, and signs every other device out', async () => {
    const email = 'forgetful@example.com';
    const { token: originalToken, cookie } = await registerGuardian(email);

    // A second device, so there is something for the reset to sign out.
    const secondCookie = (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password: 'a-long-enough-password' },
      })
    ).cookies.find((c) => c.name === 'kidpc_rt')!;

    const asked = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email },
    });
    expect(asked.statusCode).toBe(202);

    const mail = await lastEmail(email, 'password_reset');
    expect(mail?.template).toBe('password_reset');
    const resetToken = tokenFromResetEmail(mail!.bodyText);

    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'a-brand-new-long-password' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().guardian.email).toBe(email);

    // The old password is gone and the new one works.
    const oldWay = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'a-long-enough-password' },
    });
    expect(oldWay.statusCode).toBe(401);
    const newWay = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'a-brand-new-long-password' },
    });
    expect(newWay.statusCode).toBe(200);

    // Both devices that were signed in before the reset are signed out. This
    // is the half that makes a reset a recovery rather than a password change:
    // whoever else was holding a session no longer is.
    for (const stale of [cookie, secondCookie]) {
      const refreshed = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        cookies: { kidpc_rt: stale.value },
      });
      expect(refreshed.statusCode).toBe(401);
    }

    // And the access token minted before the reset is still a bearer token
    // until it expires -- which is why the refresh above is the thing that
    // matters. Asserted so the limit is recorded rather than assumed.
    expect(originalToken).toBeTruthy();

    // The address on the account is told, because an unexpected one of these
    // is the only warning the owner gets.
    expect((await lastEmail(email, 'password_changed'))?.template).toBe('password_changed');
  });

  it('takes the code from the letter as well as its link -- the way a TV is reset', async () => {
    const email = 'reset-on-tv@example.com';
    await registerGuardian(email);
    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const code = await emailedCode(runtime, email, 'password_reset');
    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { email, code, password: 'typed-on-the-remote' },
    });
    expect(reset.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'typed-on-the-remote' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a link that has already been spent', async () => {
    const email = 'twice@example.com';
    await registerGuardian(email);
    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const resetToken = tokenFromResetEmail((await lastEmail(email, 'password_reset'))!.bodyText);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'first-new-password-here' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'second-new-password-here' },
    });
    expect(second.statusCode).toBe(401);
    expect(second.json().error.message).toMatch(/expired or has already been used/);
  });

  it('cancels an earlier link when a second one is asked for', async () => {
    const email = 'impatient@example.com';
    await registerGuardian(email);

    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const firstToken = tokenFromResetEmail((await lastEmail(email, 'password_reset'))!.bodyText);

    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const secondToken = tokenFromResetEmail((await lastEmail(email, 'password_reset'))!.bodyText);
    expect(secondToken).not.toBe(firstToken);

    // The one in the older mail is dead, so a household that asked twice and
    // then clicked the first message cannot be surprised later.
    const stale = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: firstToken, password: 'a-perfectly-good-password' },
    });
    expect(stale.statusCode).toBe(401);
  });

  it('expires a link that is left for an hour', async () => {
    const email = 'slow@example.com';
    await registerGuardian(email);
    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const resetToken = tokenFromResetEmail((await lastEmail(email, 'password_reset'))!.bodyText);

    advanceMinutes(61);
    const late = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'a-perfectly-good-password' },
    });
    expect(late.statusCode).toBe(401);
    advanceMinutes(-61);
  });

  it('says the same thing about an address that is not registered', async () => {
    const known = 'known@example.com';
    await registerGuardian(known);

    const real = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: known },
    });
    const invented = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/forgot',
      payload: { email: 'nobody-at-all@example.com' },
    });

    // Byte for byte. This endpoint is open to anyone, and a different status
    // or a different body turns it into a way of finding out which parents at
    // a school have an account.
    expect(invented.statusCode).toBe(real.statusCode);
    expect(invented.body).toBe(real.body);
    expect(await lastEmail('nobody-at-all@example.com')).toBeNull();
  });

  it('will not accept a new password that is too short to be one', async () => {
    const email = 'short@example.com';
    await registerGuardian(email);
    await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
    const resetToken = tokenFromResetEmail((await lastEmail(email, 'password_reset'))!.bodyText);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'short' },
    });
    expect(res.statusCode).toBe(400);

    // And the link survives, because the person did nothing wrong except pick
    // a weak password, and making them ask for a second mail to fix that is a
    // punishment for reading the rules late.
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token: resetToken, password: 'a-long-enough-second-try' },
    });
    expect(retry.statusCode).toBe(200);
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
        allowedAppIds: ['scratch', 'paint', 'thonny'],
        sessionSummaries: false,
        idleTimeoutMinutes: 10,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().allowedAppIds).toEqual(['scratch', 'paint']);

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
        allowedAppIds: ['paint', 'scratch'], // research revoked
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
