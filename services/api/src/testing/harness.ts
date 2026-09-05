import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createRuntime, type Runtime } from '../boot.js';

/**
 * Test harness.
 *
 * Boots the same object graph `index.ts` serves, minus the listener, with a
 * clock the test drives. Scenario tests are written as stories that span hours
 * or days, so a controllable clock is not a convenience here -- it is the only
 * way to test a curfew or a midnight rollover at all.
 */
export interface Harness {
  app: FastifyInstance;
  runtime: Runtime;
  /** Jump the clock to a specific instant. */
  setClock: (at: Date) => void;
  advanceMinutes: (n: number) => void;
  now: () => Date;
  registerGuardian: (email: string, timezone?: string) => Promise<string>;
  createChild: (token: string, spec: ChildSpec) => Promise<string>;
  grantConsent: (token: string, childId: string) => Promise<void>;
  childToken: (token: string, childId: string, pin: string) => Promise<string>;
  setPolicy: (token: string, childId: string, policy: PolicySpec) => Promise<void>;
  close: () => Promise<void>;
}

export interface ChildSpec {
  displayName: string;
  birthYear: number;
  birthMonth: number;
  pin: string;
  avatarId?: string;
}

export interface PolicySpec {
  dailyMinutes: number;
  weeklyMinutes?: number | null;
  allowedWindows?: Array<{ days: number[]; start: string; end: string }>;
  allowedAppIds: string[];
  sessionSummaries?: boolean;
  idleTimeoutMinutes?: number;
}

/** Indian Standard Time, written the way the tests read best. */
export const ist = (iso: string) => new Date(`${iso}+05:30`);

const BASE_ENV = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  CONSENT_VERIFIER: 'mock',
  SESSION_DRIVER: 'loopback',
  LOG_LEVEL: 'silent',
  // Scenario tests drive many households from one address; per-IP limiting
  // would trip on the fixtures rather than on anything under test.
  RATE_LIMITS: 'off',
} as unknown as NodeJS.ProcessEnv;

export async function createHarness(
  startAt: Date,
  env: Partial<NodeJS.ProcessEnv> = {},
): Promise<Harness> {
  let clock = startAt;
  const runtime = await createRuntime({ ...BASE_ENV, ...env } as NodeJS.ProcessEnv, {
    now: () => clock,
  });
  const app = await buildApp(runtime.ctx);
  await app.ready();

  const json = (token?: string) => ({
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  const h: Harness = {
    app,
    runtime,
    now: () => clock,
    setClock: (at) => {
      clock = at;
    },
    advanceMinutes: (n) => {
      clock = new Date(clock.getTime() + n * 60_000);
    },

    async registerGuardian(email, timezone = 'Asia/Kolkata') {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { email, password: 'a-long-enough-password', displayName: 'Parent', timezone },
      });
      if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
      return res.json().accessToken as string;
    },

    async createChild(token, spec) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/children',
        headers: json(token),
        payload: { avatarId: 'fox', ...spec },
      });
      if (res.statusCode !== 201) throw new Error(`createChild failed: ${res.body}`);
      return res.json().id as string;
    },

    async grantConsent(token, childId) {
      const started = await app.inject({
        method: 'POST',
        url: `/v1/children/${childId}/consent/start`,
        headers: json(token),
        payload: { method: 'dev_mock', scopes: ['account', 'progress'] },
      });
      const { challengeId, devHint } = started.json();
      const done = await app.inject({
        method: 'POST',
        url: `/v1/children/${childId}/consent/complete`,
        headers: json(token),
        payload: { challengeId, proof: devHint },
      });
      if (done.statusCode !== 200) throw new Error(`consent failed: ${done.body}`);
    },

    async childToken(token, childId, pin) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/child/login',
        headers: json(token),
        payload: { childId, pin },
      });
      if (res.statusCode !== 200) throw new Error(`child login failed: ${res.body}`);
      return res.json().accessToken as string;
    },

    async setPolicy(token, childId, policy) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/children/${childId}/policy`,
        headers: json(token),
        payload: {
          weeklyMinutes: null,
          allowedWindows: [],
          sessionSummaries: false,
          idleTimeoutMinutes: 12,
          ...policy,
        },
      });
      if (res.statusCode !== 200) throw new Error(`setPolicy failed: ${res.body}`);
    },

    async close() {
      await app.close();
      await runtime.shutdown();
    },
  };

  return h;
}

/** Sign in a fully set-up child in one step: the common scenario preamble. */
export async function onboard(
  h: Harness,
  email: string,
  spec: ChildSpec,
  policy?: PolicySpec,
): Promise<{ guardian: string; childId: string; kid: string }> {
  const guardian = await h.registerGuardian(email);
  const childId = await h.createChild(guardian, spec);
  await h.grantConsent(guardian, childId);
  if (policy) await h.setPolicy(guardian, childId, policy);
  const kid = await h.childToken(guardian, childId, spec.pin);
  return { guardian, childId, kid };
}
