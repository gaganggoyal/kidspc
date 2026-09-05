import {
  type AgeBand,
  type ChildPolicy,
  type Session,
  type SessionEndReason,
  type SessionView,
  DEFAULT_TIMEZONE,
  ID_PREFIX,
  errors,
  localDayKey,
  memoryBudgetMib,
  minutesSinceLocalMidnight,
  newId,
  originsForApps,
} from '@kidpc/shared';
import { evaluateAppLaunch, evaluateSessionStart, visibleApps } from '@kidpc/policy';
import { type DesktopHandle, type SessionDriver, sizeForBand } from './driver.js';

/**
 * Persistence port.
 *
 * The manager owns the session lifecycle; it does not own a database. Keeping
 * storage behind this interface is what makes the lifecycle tests -- which are
 * the ones that matter, because they cover a child's time running out -- fast
 * and free of fixtures.
 */
export interface SessionStore {
  insert(session: Session): Promise<void>;
  update(id: string, patch: Partial<Session>): Promise<void>;
  byId(id: string): Promise<Session | null>;
  /** The one non-terminated session for a child, if any. */
  liveForChild(childId: string): Promise<Session | null>;
  allLive(): Promise<Session[]>;
  addUsageMinutes(childId: string, dayKey: string, minutes: number): Promise<void>;
}

/** Everything about a child the manager needs, gathered by the caller. */
export interface StartContext {
  childId: string;
  guardianId: string;
  band: AgeBand | null;
  policy: ChildPolicy;
  consentGranted: boolean;
  archived: boolean;
  timezone: string;
  usage: { todayMinutes: number; weekMinutes: number };
}

export interface StartOptions {
  appId?: string;
  deviceKind?: 'tv' | 'browser';
}

export type StartResult =
  | { ok: true; session: Session; view: SessionView }
  | { ok: false; reason: string; userMessage: string; retryAt: Date | null };

export interface ManagerOptions {
  driver: SessionDriver;
  store: SessionStore;
  /** Injected so tests can advance time without waiting for it. */
  now?: () => Date;
  /** How long to wait for a desktop to accept connections before giving up. */
  readyTimeoutMs?: number;
  /** Volume naming; one persistent home per child. */
  homeVolumeFor?: (childId: string) => string;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

const MS_PER_MINUTE = 60_000;

export class SessionManager {
  private readonly driver: SessionDriver;
  private readonly store: SessionStore;
  private readonly now: () => Date;
  private readonly readyTimeoutMs: number;
  private readonly homeVolumeFor: (childId: string) => string;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;

  /** Guards against a double-tap on the remote producing two containers. */
  private readonly starting = new Map<string, Promise<StartResult>>();

  constructor(options: ManagerOptions) {
    this.driver = options.driver;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.readyTimeoutMs = options.readyTimeoutMs ?? 45_000;
    this.homeVolumeFor = options.homeVolumeFor ?? ((childId) => `kidpc-home-${childId}`);
    this.log = options.log ?? (() => {});
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  async start(ctx: StartContext, options: StartOptions = {}): Promise<StartResult> {
    // Children press buttons fast and TV apps retry on flaky wifi. Collapsing
    // concurrent starts per child is cheaper than reconciling duplicates.
    const inFlight = this.starting.get(ctx.childId);
    if (inFlight) return inFlight;

    const promise = this.startInner(ctx, options).finally(() => {
      this.starting.delete(ctx.childId);
    });
    this.starting.set(ctx.childId, promise);
    return promise;
  }

  private async startInner(ctx: StartContext, options: StartOptions): Promise<StartResult> {
    const now = this.now();

    const existing = await this.store.liveForChild(ctx.childId);
    if (existing) {
      // The app gate runs on this path too. Nothing is launched into a running
      // session yet, so skipping it would be harmless in effect -- but an API
      // that accepts an `appId` it never checks is one refactor away from
      // being a real hole, and the child deserves the same answer either way.
      if (options.appId && ctx.band) {
        const appDecision = evaluateAppLaunch(ctx.policy, ctx.band, options.appId);
        if (!appDecision.allowed) {
          return {
            ok: false,
            reason: appDecision.reason,
            userMessage: appDecision.userMessage,
            retryAt: null,
          };
        }
      }
      // Resuming beats provisioning: the child gets their work back, and we
      // don't pay to boot a second desktop.
      //
      // TODO: launching the requested app *into* a running session needs a
      // driver capability we do not have. Today a child who taps a different
      // app gets their desktop back without it, which is a real gap.
      const resumed = await this.resume(existing, now);
      return { ok: true, session: resumed, view: this.toView(resumed, now) };
    }

    const decision = evaluateSessionStart({
      policy: ctx.policy,
      band: ctx.band,
      consentGranted: ctx.consentGranted,
      archived: ctx.archived,
      usage: ctx.usage,
      now,
      timezone: ctx.timezone,
    });

    if (!decision.allowed) {
      this.log('session.denied', { childId: ctx.childId, reason: decision.reason });
      return {
        ok: false,
        reason: decision.reason,
        userMessage: decision.userMessage,
        retryAt: decision.retryAt,
      };
    }

    const band = ctx.band!; // evaluateSessionStart rejects a null band above.

    let autoLaunchAppId: string | null = null;
    if (options.appId) {
      const appDecision = evaluateAppLaunch(ctx.policy, band, options.appId);
      if (!appDecision.allowed) {
        return {
          ok: false,
          reason: appDecision.reason,
          userMessage: appDecision.userMessage,
          retryAt: null,
        };
      }
      autoLaunchAppId = appDecision.app.id;
    }

    const grantedApps = visibleApps(ctx.policy, band);
    const size = sizeForBand(band, memoryBudgetMib(grantedApps));
    const sessionId = newId(ID_PREFIX.session);

    let handle: DesktopHandle;
    try {
      handle = await this.driver.provision({
        sessionId,
        childId: ctx.childId,
        band,
        cpuCentis: size.cpuCentis,
        memoryMib: size.memoryMib,
        allowedOrigins: originsForApps(grantedApps),
        autoLaunch: autoLaunchAppId
          ? (grantedApps.find((a) => a.id === autoLaunchAppId)?.launch ?? null)
          : null,
        homeVolume: this.homeVolumeFor(ctx.childId),
        deadline: decision.deadline,
      });
    } catch (cause) {
      this.log('session.provision_failed', { childId: ctx.childId, error: String(cause) });
      throw errors.capacity();
    }

    try {
      await this.driver.waitUntilReady(handle, this.readyTimeoutMs);
    } catch (cause) {
      // Never leave a half-born desktop holding memory.
      await this.driver.terminate(handle, 'failed_to_start').catch(() => undefined);
      this.log('session.ready_timeout', { sessionId, error: String(cause) });
      throw errors.capacity();
    }

    const readyAt = this.now();
    const session: Session = {
      id: sessionId,
      childId: ctx.childId,
      guardianId: ctx.guardianId,
      state: 'ready',
      driverRef: handle.ref,
      driverName: handle.driver,
      deviceKind: options.deviceKind ?? 'browser',
      autoLaunchAppId,
      createdAt: now,
      readyAt,
      lastHeartbeatAt: readyAt,
      endedAt: null,
      endReason: null,
      deadline: decision.deadline,
      limitedBy: decision.limitedBy,
      idleTimeoutMinutes: ctx.policy.idleTimeoutMinutes,
      timezone: ctx.timezone || DEFAULT_TIMEZONE,
      billedMinutes: 0,
      // Billing starts when the child can actually use the desktop, not when
      // they asked for it. Boot time is our cost, not theirs.
      lastBilledAt: readyAt,
      endpointHost: handle.endpoint.host,
      endpointPort: handle.endpoint.port,
      endpointSecret: handle.endpoint.secret,
    };

    await this.store.insert(session);
    this.log('session.start', {
      sessionId,
      childId: ctx.childId,
      grantedMinutes: decision.grantedMinutes,
      limitedBy: decision.limitedBy,
      bootMs: readyAt.getTime() - now.getTime(),
    });

    return { ok: true, session, view: this.toView(session, readyAt) };
  }

  private async resume(session: Session, now: Date): Promise<Session> {
    if (session.state !== 'suspended') return session;
    const patch: Partial<Session> = { state: 'active', lastHeartbeatAt: now, lastBilledAt: now };
    await this.store.update(session.id, patch);
    this.log('session.resume', { sessionId: session.id });
    return { ...session, ...patch };
  }

  // -------------------------------------------------------------------------
  // Keeping alive
  // -------------------------------------------------------------------------

  /**
   * Called by the client every ~30s while a child is at the screen. Doubles as
   * the billing tick, so a client that stops calling stops consuming budget --
   * which is the behaviour a parent expects when the TV is switched off.
   */
  async heartbeat(sessionId: string): Promise<SessionView> {
    const session = await this.store.byId(sessionId);
    if (!session || session.state === 'terminated') throw errors.notFound('Session');

    const now = this.now();
    const billed = await this.bill(session, now);
    const patch: Partial<Session> = { ...billed, state: 'active', lastHeartbeatAt: now };

    // Persist before deciding whether to end. `bill` has already written those
    // minutes to the usage ledger and advanced its watermark, so if we handed
    // the in-memory session to `end` first, its own `bill` call would find
    // nothing left to do and the session's own counter would never catch up --
    // leaving the ledger and the session record permanently disagreeing about
    // how much time the child actually used.
    await this.store.update(session.id, patch);
    const updated = { ...session, ...patch };

    if (now >= updated.deadline) {
      const ended = await this.end(updated, 'budget_exhausted', now);
      return this.toView(ended, now);
    }
    return this.toView(updated, now);
  }

  // -------------------------------------------------------------------------
  // Billing
  // -------------------------------------------------------------------------

  /**
   * Move consumed time from the session into the child's usage ledger.
   *
   * Only whole minutes are banked, and the watermark advances by exactly what
   * was banked, so repeated calls neither lose seconds nor double-charge. A
   * session that runs across local midnight is split so each minute lands on
   * the day the child actually spent it -- otherwise an evening session would
   * quietly eat into tomorrow's allowance.
   */
  private async bill(session: Session, until: Date): Promise<Partial<Session>> {
    // Never bill past the lease. The grant is a promise about the maximum a
    // child can be charged, and a reaper that runs a little late must not turn
    // a 45-minute grant into 50 minutes off tomorrow's allowance.
    const cutoff = until > session.deadline ? session.deadline : until;
    const elapsedMinutes = Math.floor((cutoff.getTime() - session.lastBilledAt.getTime()) / MS_PER_MINUTE);
    if (elapsedMinutes <= 0) return {};

    const billedTo = new Date(session.lastBilledAt.getTime() + elapsedMinutes * MS_PER_MINUTE);
    for (const slice of splitByLocalDay(session.lastBilledAt, billedTo, session.timezone)) {
      if (slice.minutes > 0) {
        await this.store.addUsageMinutes(session.childId, slice.dayKey, slice.minutes);
      }
    }

    return {
      billedMinutes: session.billedMinutes + elapsedMinutes,
      lastBilledAt: billedTo,
    };
  }

  // -------------------------------------------------------------------------
  // Ending
  // -------------------------------------------------------------------------

  async endById(sessionId: string, reason: SessionEndReason): Promise<void> {
    const session = await this.store.byId(sessionId);
    if (!session || session.state === 'terminated') return;
    await this.end(session, reason, this.now());
  }

  private async end(
    session: Session,
    reason: SessionEndReason,
    now: Date,
    /**
     * How far to bill. Defaults to `now`, which is right when someone told us
     * they were finishing. The reaper passes the last heartbeat instead,
     * because it is acting on silence rather than on evidence.
     */
    billUntil: Date = now,
  ): Promise<Session> {
    const billed = await this.bill(session, billUntil);

    if (session.driverRef) {
      await this.driver
        .terminate(
          {
            ref: session.driverRef,
            driver: session.driverName,
            endpoint: {
              host: session.endpointHost ?? '',
              port: session.endpointPort ?? 0,
              secret: session.endpointSecret ?? '',
            },
          },
          reason,
        )
        .catch((cause) => {
          // A desktop we cannot kill is a capacity leak, not a user-facing
          // failure: record it loudly and let reconciliation try again.
          this.log('session.terminate_failed', { sessionId: session.id, error: String(cause) });
        });
    }

    const patch: Partial<Session> = {
      ...billed,
      state: 'terminated',
      endedAt: now,
      endReason: reason,
      // The connection secret has no purpose past this point.
      endpointSecret: null,
    };
    await this.store.update(session.id, patch);
    this.log('session.end', {
      sessionId: session.id,
      reason,
      billedMinutes: (billed.billedMinutes ?? session.billedMinutes),
    });
    return { ...session, ...patch };
  }

  // -------------------------------------------------------------------------
  // Reaping
  // -------------------------------------------------------------------------

  /**
   * Periodic sweep. This is the function that decides whether the unit
   * economics hold: an idle desktop nobody reclaimed is pure loss, so it runs
   * on a short interval and is deliberately conservative about what it keeps.
   */
  async reap(): Promise<{ ended: number; orphansRemoved: number }> {
    const now = this.now();
    const live = await this.store.allLive();
    let ended = 0;

    for (const session of live) {
      try {
        if (now >= session.deadline) {
          await this.end(session, 'budget_exhausted', now);
          ended++;
          continue;
        }

        const idleSince = session.lastHeartbeatAt ?? session.readyAt ?? session.createdAt;
        const idleMinutes = (now.getTime() - idleSince.getTime()) / MS_PER_MINUTE;
        // Ended, not suspended. A stopped container still holds its disk and
        // its slot, and a desktop is cheap to recreate because the only thing
        // worth keeping -- the child's home -- lives on a volume that outlives
        // it. The `suspended` state stays in the model for a future warm-pool
        // optimisation; nothing sets it today.
        if (idleMinutes >= session.idleTimeoutMinutes) {
          // Charged to the last heartbeat, not to now. A child called away to
          // dinner should not lose the twelve minutes it took us to notice --
          // a parent looking at the dashboard would call that a bug, and they
          // would be right.
          await this.end(session, 'idle_timeout', now, idleSince);
          ended++;
          continue;
        }

        if (session.driverRef) {
          const status = await this.driver.inspect({
            ref: session.driverRef,
            driver: session.driverName,
            endpoint: {
              host: session.endpointHost ?? '',
              port: session.endpointPort ?? 0,
              secret: session.endpointSecret ?? '',
            },
          });
          if (!status.running) {
            // The desktop died under us. We do not know when, so we bank only
            // the time we have evidence for and close the record rather than
            // leaving a child in front of a black screen.
            await this.end(session, 'system_error', now, idleSince);
            ended++;
            continue;
          }
        }

        // Same rule for the routine tick: bank up to the last heartbeat, and
        // let the next heartbeat bank the rest.
        const billed = await this.bill(session, idleSince);
        if (Object.keys(billed).length > 0) await this.store.update(session.id, billed);
      } catch (cause) {
        this.log('reap.session_failed', { sessionId: session.id, error: String(cause) });
      }
    }

    const orphansRemoved = await this.reconcile(live);
    return { ended, orphansRemoved };
  }

  /**
   * Kill desktops the control plane has no record of.
   *
   * These appear after a crash between `provision` and `insert`, and they are
   * invisible to every other code path -- nobody is billed for them and nobody
   * will ever reclaim them.
   */
  private async reconcile(live: Session[]): Promise<number> {
    let removed = 0;
    let handles: DesktopHandle[];
    try {
      handles = await this.driver.list();
    } catch (cause) {
      this.log('reap.list_failed', { error: String(cause) });
      return 0;
    }

    const known = new Set(live.map((s) => s.driverRef).filter(Boolean) as string[]);
    for (const handle of handles) {
      if (known.has(handle.ref)) continue;
      this.log('reap.orphan', { ref: handle.ref });
      await this.driver.terminate(handle, 'orphan').catch(() => undefined);
      removed++;
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  /** The only place a Session becomes something a client may see. */
  toView(session: Session, now: Date = this.now()): SessionView {
    const remainingMs = Math.max(0, session.deadline.getTime() - now.getTime());
    return {
      id: session.id,
      childId: session.childId,
      state: session.state,
      deadline: session.deadline.toISOString(),
      grantedMinutes: Math.round(
        (session.deadline.getTime() - (session.readyAt ?? session.createdAt).getTime()) / MS_PER_MINUTE,
      ),
      // Round up: a grant issued a few hundred milliseconds ago is still a
      // full 45 minutes to the child looking at it, not 44.
      remainingMinutes: Math.ceil(remainingMs / MS_PER_MINUTE),
      autoLaunchAppId: session.autoLaunchAppId,
      streamPath: session.state === 'terminated' ? null : `/stream/${session.id}`,
    };
  }
}

/**
 * Split `[from, to)` into whole-minute chunks keyed by the local day each falls in.
 * Exported for tests: the midnight-crossing case is easy to get wrong and
 * expensive to get wrong, because it silently misprices a child's allowance.
 */
export function splitByLocalDay(
  from: Date,
  to: Date,
  timezone: string,
): Array<{ dayKey: string; minutes: number }> {
  const out: Array<{ dayKey: string; minutes: number }> = [];
  let cursor = from;

  while (cursor < to) {
    const minutesIntoDay = minutesSinceLocalMidnight(cursor, timezone);
    const nextMidnight = new Date(cursor.getTime() + (1440 - minutesIntoDay) * MS_PER_MINUTE);
    const chunkEnd = nextMidnight < to ? nextMidnight : to;
    const minutes = Math.round((chunkEnd.getTime() - cursor.getTime()) / MS_PER_MINUTE);
    const dayKey = localDayKey(cursor, timezone);
    const last = out.at(-1);
    if (last && last.dayKey === dayKey) last.minutes += minutes;
    else out.push({ dayKey, minutes });
    cursor = chunkEnd;
  }

  return out;
}
