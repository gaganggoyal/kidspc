import { beforeEach, describe, expect, it } from 'vitest';
import type { ChildPolicy, Session } from '@kidpc/shared';
import { LoopbackDriver } from './drivers/loopback.js';
import { SessionManager, type SessionStore, type StartContext, splitByLocalDay } from './manager.js';

const ist = (iso: string) => new Date(`${iso}+05:30`);

/** Minimal in-memory store: the real one is Drizzle, the contract is this. */
class MemoryStore implements SessionStore {
  sessions = new Map<string, Session>();
  usage = new Map<string, number>();

  async insert(session: Session) {
    this.sessions.set(session.id, { ...session });
  }
  async update(id: string, patch: Partial<Session>) {
    const existing = this.sessions.get(id);
    if (existing) this.sessions.set(id, { ...existing, ...patch });
  }
  async byId(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async liveForChild(childId: string) {
    return (
      [...this.sessions.values()].find((s) => s.childId === childId && s.state !== 'terminated') ??
      null
    );
  }
  async allLive() {
    return [...this.sessions.values()].filter((s) => s.state !== 'terminated');
  }
  async addUsageMinutes(childId: string, dayKey: string, minutes: number) {
    const key = `${childId}|${dayKey}`;
    this.usage.set(key, (this.usage.get(key) ?? 0) + minutes);
  }
  minutesOn(childId: string, dayKey: string) {
    return this.usage.get(`${childId}|${dayKey}`) ?? 0;
  }
}

function policy(over: Partial<ChildPolicy> = {}): ChildPolicy {
  return {
    childId: 'kid_1',
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

function context(over: Partial<StartContext> = {}): StartContext {
  return {
    childId: 'kid_1',
    guardianId: 'gdn_1',
    band: 'builder',
    policy: policy(),
    consentGranted: true,
    archived: false,
    timezone: 'Asia/Kolkata',
    usage: { todayMinutes: 0, weekMinutes: 0 },
    ...over,
  };
}

describe('SessionManager', () => {
  let store: MemoryStore;
  let driver: LoopbackDriver;
  let clock: Date;
  let manager: SessionManager;

  beforeEach(() => {
    store = new MemoryStore();
    driver = new LoopbackDriver(0);
    clock = ist('2026-03-11T16:00:00');
    manager = new SessionManager({
      driver,
      store,
      now: () => clock,
      readyTimeoutMs: 1_000,
    });
  });

  const advance = (minutes: number) => {
    clock = new Date(clock.getTime() + minutes * 60_000);
  };

  it('provisions a desktop and hands back a lease, not a container', async () => {
    const result = await manager.start(context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.state).toBe('ready');
    expect(result.session.driverRef).toBeTruthy();
    expect(result.view.remainingMinutes).toBe(60);
    expect(result.view.streamPath).toBe(`/stream/${result.session.id}`);
    // The connection secret must never leave the control plane.
    expect(JSON.stringify(result.view)).not.toContain(result.session.endpointSecret!);
  });

  it('refuses to start when policy says no, without touching the driver', async () => {
    const result = await manager.start(context({ consentGranted: false }));
    expect(result).toMatchObject({ ok: false, reason: 'consent_required' });
    expect(await driver.list()).toHaveLength(0);
  });

  it('collapses a double-tap into one desktop', async () => {
    const [a, b] = await Promise.all([manager.start(context()), manager.start(context())]);
    expect(a.ok && b.ok).toBe(true);
    expect(await driver.list()).toHaveLength(1);
  });

  it('returns the existing session instead of provisioning a second one', async () => {
    const first = await manager.start(context());
    const second = await manager.start(context());
    expect(first.ok && second.ok && first.session.id === second.session.id).toBe(true);
    expect(await driver.list()).toHaveLength(1);
  });

  it('gives the child their whole grant even when the desktop is slow to boot', async () => {
    // Every other test here uses an instant driver, which is exactly why this
    // bug survived: with zero boot time the request clock and the ready clock
    // coincide and the mismatch is invisible.
    const slowDriver = new LoopbackDriver(0);
    let provisionedAt: Date | null = null;
    const original = slowDriver.provision.bind(slowDriver);
    slowDriver.provision = async (spec) => {
      provisionedAt = clock;
      clock = new Date(clock.getTime() + 20_000); // 20 seconds to boot
      return original(spec);
    };

    const m = new SessionManager({ driver: slowDriver, store, now: () => clock });
    const started = await m.start(context({ policy: policy({ dailyMinutes: 1 }) }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(provisionedAt).not.toBeNull();

    // A one-minute grant must be a full minute of usable time measured from
    // when the desktop was ready, not sixty seconds from the button press.
    expect(started.session.deadline.getTime() - started.session.readyAt!.getTime()).toBe(60_000);
    expect(started.view.remainingMinutes).toBe(1);

    // ...and it must bill as one minute, not round down to nothing.
    advance(1);
    await m.heartbeat(started.session.id);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(1);
  });

  it('does not bill the child for boot time', async () => {
    const slowDriver = new LoopbackDriver(0);
    const m = new SessionManager({ driver: slowDriver, store, now: () => clock });
    const result = await m.start(context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.lastBilledAt).toEqual(result.session.readyAt);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(0);
  });

  it('bills whole minutes on heartbeat and never double-charges', async () => {
    const started = await manager.start(context());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(10);
    await manager.heartbeat(started.session.id);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(10);

    // A heartbeat 30 seconds later banks nothing: partial minutes stay pending.
    clock = new Date(clock.getTime() + 30_000);
    await manager.heartbeat(started.session.id);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(10);

    // ...and are not lost either -- the next full minute still lands.
    clock = new Date(clock.getTime() + 30_000);
    await manager.heartbeat(started.session.id);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(11);
  });

  it('splits a session that runs past local midnight across two days', async () => {
    clock = ist('2026-03-11T23:40:00');
    const started = await manager.start(context({ policy: policy({ dailyMinutes: 120 }) }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(40); // 23:40 -> 00:20
    await manager.heartbeat(started.session.id);

    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(20);
    expect(store.minutesOn('kid_1', '2026-03-12')).toBe(20);
  });

  it('ends the session at its deadline and releases the desktop', async () => {
    const started = await manager.start(context());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(61);
    const view = await manager.heartbeat(started.session.id);
    expect(view.state).toBe('terminated');
    expect((await store.byId(started.session.id))?.endReason).toBe('budget_exhausted');
    expect(await driver.list()).toHaveLength(0);
    // Exactly the grant, not a minute more. The heartbeat arrived 61 minutes
    // in, but the lease promised 60 -- a late tick is our problem, not a
    // charge against tomorrow's allowance.
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(60);
  });

  it('keeps the session counter and the usage ledger in agreement when time runs out', async () => {
    // Regression: the deadline path used to bank minutes in the ledger without
    // persisting them on the session, so a parent's dashboard and a child's
    // budget disagreed about the same minutes.
    const started = await manager.start(context());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(20);
    await manager.heartbeat(started.session.id);
    advance(50); // past the 60-minute grant
    await manager.heartbeat(started.session.id);

    const stored = await store.byId(started.session.id);
    expect(stored?.state).toBe('terminated');
    // Capped at the 60-minute grant even though 70 minutes of wall clock
    // passed between the two heartbeats.
    expect(stored?.billedMinutes).toBe(60);
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(stored?.billedMinutes);
  });

  it('reaps an idle session so nobody pays for an empty room', async () => {
    const started = await manager.start(context({ policy: policy({ idleTimeoutMinutes: 12 }) }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(11);
    expect(await manager.reap()).toMatchObject({ ended: 0 });
    advance(2);
    expect(await manager.reap()).toMatchObject({ ended: 1 });

    expect((await store.byId(started.session.id))?.endReason).toBe('idle_timeout');
    expect(await driver.list()).toHaveLength(0);
  });

  it('closes the record when a desktop dies underneath us', async () => {
    const started = await manager.start(context());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(5);
    driver.killUnderlying(started.session.driverRef!);
    await manager.reap();

    const after = await store.byId(started.session.id);
    expect(after?.endReason).toBe('system_error');
    // No heartbeat was ever sent, so there is no evidence the child used any
    // of it. We do not know when the desktop died, and guessing in our own
    // favour is not an option when the guess costs a child their afternoon.
    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(0);
  });

  it('bills a crashed session up to its last sign of life', async () => {
    const started = await manager.start(context());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    advance(8);
    await manager.heartbeat(started.session.id); // last evidence: 8 minutes in
    advance(7);
    driver.killUnderlying(started.session.driverRef!);
    await manager.reap();

    expect(store.minutesOn('kid_1', '2026-03-11')).toBe(8);
  });

  it('removes desktops the control plane has no record of', async () => {
    await driver.provision({
      sessionId: 'ses_ghost',
      childId: 'kid_ghost',
      band: 'builder',
      cpuCentis: 100,
      memoryMib: 1024,
      allowedOrigins: [],
      autoLaunch: null,
      homeVolume: 'vol',
      deadline: new Date(clock.getTime() + 3_600_000),
    });
    expect(await driver.list()).toHaveLength(1);

    expect(await manager.reap()).toMatchObject({ orphansRemoved: 1 });
    expect(await driver.list()).toHaveLength(0);
  });

  it('rejects an auto-launch the parent has switched off, before provisioning', async () => {
    const result = await manager.start(context({ policy: policy({ allowedAppIds: [] }) }), {
      appId: 'scratch',
    });
    expect(result).toMatchObject({ ok: false, reason: 'not_allowed_by_parent' });
    expect(await driver.list()).toHaveLength(0);
  });

  it('applies the app gate even when resuming an existing session', async () => {
    await manager.start(context());
    const denied = await manager.start(context({ band: 'explorer' }), { appId: 'scratch' });
    expect(denied).toMatchObject({ ok: false, reason: 'band_too_low' });
    // Still exactly one desktop: the denial did not tear anything down.
    expect(await driver.list()).toHaveLength(1);
  });

  it('sizes the desktop from the apps the child can actually open', async () => {
    const started = await manager.start(
      context({ band: 'explorer', policy: policy({ allowedAppIds: ['paint'] }) }),
    );
    expect(started.ok).toBe(true);

    const spec = driver.provisioned[0]!;
    // One paint program on the Explorer band: the floor, not a Coder footprint.
    expect(spec.cpuCentis).toBe(100);
    expect(spec.memoryMib).toBe(1024);
  });

  it('gives a Coder more headroom than an Explorer', async () => {
    await manager.start(
      context({ band: 'coder', policy: policy({ allowedAppIds: ['office', 'code'] }) }),
    );
    const spec = driver.provisioned[0]!;
    expect(spec.cpuCentis).toBe(200);
    expect(spec.memoryMib).toBeGreaterThanOrEqual(1536);
    expect(spec.memoryMib % 256).toBe(0);
  });

  it('scopes the desktop egress list to the granted apps only', async () => {
    await manager.start(context({ policy: policy({ allowedAppIds: ['paint', 'scratch'] }) }));
    // Neither app reaches outside our own hosts, so nothing external is opened.
    expect(driver.provisioned[0]!.allowedOrigins).toEqual(['https://apps.kidspc.online']);
  });

  it('opens the research origins only when the research app is granted', async () => {
    await manager.start(
      context({ policy: policy({ allowedAppIds: ['paint', 'research'] }) }),
    );
    expect(driver.provisioned[0]!.allowedOrigins).toContain('https://kids.britannica.com');
  });
});

describe('splitByLocalDay', () => {
  it('keeps a same-day span in one bucket', () => {
    expect(splitByLocalDay(ist('2026-03-11T10:00:00'), ist('2026-03-11T10:45:00'), 'Asia/Kolkata')).toEqual([
      { dayKey: '2026-03-11', minutes: 45 },
    ]);
  });

  it('splits at local midnight, not UTC midnight', () => {
    // 18:30 UTC is midnight IST; a naive UTC split would put both halves on the
    // 11th and let a child spend tomorrow's allowance tonight.
    expect(splitByLocalDay(ist('2026-03-11T23:30:00'), ist('2026-03-12T00:30:00'), 'Asia/Kolkata')).toEqual([
      { dayKey: '2026-03-11', minutes: 30 },
      { dayKey: '2026-03-12', minutes: 30 },
    ]);
  });

  it('handles spans longer than a day', () => {
    const slices = splitByLocalDay(ist('2026-03-11T22:00:00'), ist('2026-03-13T02:00:00'), 'Asia/Kolkata');
    expect(slices.map((s) => s.dayKey)).toEqual(['2026-03-11', '2026-03-12', '2026-03-13']);
    expect(slices.reduce((sum, s) => sum + s.minutes, 0)).toBe(28 * 60);
  });
});
