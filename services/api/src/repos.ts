import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  type AgeBand,
  type AuditAction,
  type ChildPolicy,
  type ChildProfile,
  type ConsentScope,
  type Guardian,
  METRIC_HIGHER_IS_BETTER,
  type ProgressMetric,
  type Session,
  ID_PREFIX,
  bandAtLeast,
  defaultAllowedAppIds,
  localDayKey,
  localWeekday,
  newId,
} from '@kidpc/shared';
import type { SessionStore } from '@kidpc/broker';
import type { Database } from './db/client.js';
import {
  activityProgress,
  auditEvents,
  children,
  consentChallenges,
  consents,
  guardians,
  policies,
  refreshTokens,
  sessions,
  usageDays,
} from './db/schema.js';

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

export class GuardianRepo {
  constructor(private readonly db: Database) {}

  async create(input: {
    email: string;
    passwordHash: string;
    displayName: string;
    timezone: string;
  }): Promise<Guardian> {
    const [row] = await this.db
      .insert(guardians)
      .values({ id: newId(ID_PREFIX.guardian), ...input })
      .returning();
    return toGuardian(row!);
  }

  async byEmail(email: string) {
    const [row] = await this.db
      .select()
      .from(guardians)
      .where(sql`lower(${guardians.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return row ?? null;
  }

  async byId(id: string) {
    const [row] = await this.db.select().from(guardians).where(eq(guardians.id, id)).limit(1);
    return row ?? null;
  }

  async markLogin(id: string) {
    await this.db.update(guardians).set({ lastLoginAt: new Date() }).where(eq(guardians.id, id));
  }

  async requestDeletion(id: string) {
    await this.db
      .update(guardians)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(guardians.id, id));
  }

  /** Hard delete. Every child row, session and consent cascades from here. */
  async purge(id: string) {
    await this.db.delete(guardians).where(eq(guardians.id, id));
  }
}

function toGuardian(row: typeof guardians.$inferSelect): Guardian {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    timezone: row.timezone,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------

export class RefreshTokenRepo {
  constructor(private readonly db: Database) {}

  async issue(guardianId: string, tokenHash: string, ttlDays: number): Promise<string> {
    const id = newId(ID_PREFIX.token);
    await this.db.insert(refreshTokens).values({
      id,
      guardianId,
      tokenHash,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    });
    return id;
  }

  async findValid(tokenHash: string) {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gte(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async revoke(id: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, id));
  }

  /** Used on password change and on "sign out everywhere". */
  async revokeAllFor(guardianId: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.guardianId, guardianId), isNull(refreshTokens.revokedAt)));
  }
}

// ---------------------------------------------------------------------------
// Children and policies
// ---------------------------------------------------------------------------

/**
 * Starting policy for a new profile.
 *
 * Deliberately conservative: a parent who never opens the dashboard should
 * still end up with a sane amount of screen time, and loosening a limit is a
 * decision we want them to make on purpose.
 */
export function defaultPolicyFor(band: AgeBand): Omit<ChildPolicy, 'childId' | 'updatedAt'> {
  const byBand: Record<AgeBand, { dailyMinutes: number; idleTimeoutMinutes: number }> = {
    explorer: { dailyMinutes: 30, idleTimeoutMinutes: 10 },
    builder: { dailyMinutes: 45, idleTimeoutMinutes: 12 },
    coder: { dailyMinutes: 60, idleTimeoutMinutes: 15 },
  };
  return {
    ...byBand[band],
    weeklyMinutes: null,
    allowedWindows: [],
    allowedAppIds: defaultAllowedAppIds(band),
    sessionSummaries: false,
    grantedForBand: band,
  };
}

export class ChildRepo {
  constructor(private readonly db: Database) {}

  async create(input: {
    guardianId: string;
    displayName: string;
    birthYear: number;
    birthMonth: number;
    avatarId: string;
    pinHash: string;
    band: AgeBand;
  }): Promise<ChildProfile> {
    const id = newId(ID_PREFIX.child);
    // Profile and policy are created together: a child must never exist for
    // even an instant without limits attached.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(children)
        .values({
          id,
          guardianId: input.guardianId,
          displayName: input.displayName,
          birthYear: input.birthYear,
          birthMonth: input.birthMonth,
          avatarId: input.avatarId,
          pinHash: input.pinHash,
        })
        .returning();
      await tx.insert(policies).values({ childId: id, ...defaultPolicyFor(input.band) });
      return toChild(row!);
    });
  }

  async listFor(guardianId: string) {
    return this.db
      .select()
      .from(children)
      .where(eq(children.guardianId, guardianId))
      .orderBy(children.createdAt);
  }

  async byId(id: string) {
    const [row] = await this.db.select().from(children).where(eq(children.id, id)).limit(1);
    return row ?? null;
  }

  async update(id: string, patch: Partial<typeof children.$inferInsert>) {
    await this.db.update(children).set(patch).where(eq(children.id, id));
  }

  async archive(id: string) {
    await this.db.update(children).set({ archivedAt: new Date() }).where(eq(children.id, id));
  }
}

function toChild(row: typeof children.$inferSelect): ChildProfile {
  return {
    id: row.id,
    guardianId: row.guardianId,
    displayName: row.displayName,
    birthYear: row.birthYear,
    birthMonth: row.birthMonth,
    avatarId: row.avatarId,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

export class PolicyRepo {
  constructor(private readonly db: Database) {}

  async forChild(childId: string): Promise<ChildPolicy | null> {
    const [row] = await this.db.select().from(policies).where(eq(policies.childId, childId)).limit(1);
    return row ? toPolicy(row) : null;
  }

  async forChildren(childIds: string[]): Promise<Map<string, ChildPolicy>> {
    if (childIds.length === 0) return new Map();
    const rows = await this.db.select().from(policies).where(inArray(policies.childId, childIds));
    return new Map(rows.map((r) => [r.childId, toPolicy(r)]));
  }

  async update(childId: string, patch: Omit<ChildPolicy, 'childId' | 'updatedAt'>) {
    await this.db
      .update(policies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(policies.childId, childId));
  }

  /**
   * The policy for a child who is now in `band`, upgrading it if they have
   * grown into a new one since it was last written.
   *
   * The launcher tells children that apps unlock as they get older, so they
   * have to actually unlock -- without a parent needing to notice a birthday
   * and go tick boxes. Only apps the previous band never offered are added, so
   * anything a parent switched off deliberately stays off.
   *
   * This is a write on a read path. It is idempotent and happens at most twice
   * in a child's life, which is a better trade than a nightly job that has to
   * know every household's timezone to decide when a birthday happened.
   */
  async forChildInBand(childId: string, band: AgeBand): Promise<ChildPolicy | null> {
    const policy = await this.forChild(childId);
    if (!policy) return null;
    if (policy.grantedForBand === band || !bandAtLeast(band, policy.grantedForBand)) return policy;

    const alreadyOffered = new Set(defaultAllowedAppIds(policy.grantedForBand));
    const newlyOffered = defaultAllowedAppIds(band).filter((id) => !alreadyOffered.has(id));
    const allowedAppIds = [...new Set([...policy.allowedAppIds, ...newlyOffered])];

    await this.db
      .update(policies)
      .set({ allowedAppIds, grantedForBand: band })
      .where(eq(policies.childId, childId));

    return { ...policy, allowedAppIds, grantedForBand: band };
  }
}

function toPolicy(row: typeof policies.$inferSelect): ChildPolicy {
  return {
    childId: row.childId,
    dailyMinutes: row.dailyMinutes,
    weeklyMinutes: row.weeklyMinutes,
    allowedWindows: row.allowedWindows,
    allowedAppIds: row.allowedAppIds,
    sessionSummaries: row.sessionSummaries,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    grantedForBand: row.grantedForBand,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export class ConsentRepo {
  constructor(private readonly db: Database) {}

  async createChallenge(input: {
    guardianId: string;
    childId: string;
    method: string;
    scopes: ConsentScope[];
    nonce: string;
    ttlMinutes: number;
  }) {
    const id = newId(ID_PREFIX.consent);
    await this.db.insert(consentChallenges).values({
      id,
      guardianId: input.guardianId,
      childId: input.childId,
      method: input.method,
      scopes: input.scopes,
      nonce: input.nonce,
      expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
    });
    return id;
  }

  async takeChallenge(id: string) {
    // Single-use: consumed atomically so a proof cannot be replayed.
    const [row] = await this.db
      .update(consentChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(consentChallenges.id, id),
          isNull(consentChallenges.consumedAt),
          gte(consentChallenges.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  async grant(input: {
    guardianId: string;
    childId: string;
    method: string;
    scopes: ConsentScope[];
    proofDigest: string;
    expiresInDays: number | null;
  }) {
    const id = newId(ID_PREFIX.consent);
    await this.db.insert(consents).values({
      id,
      guardianId: input.guardianId,
      childId: input.childId,
      method: input.method,
      scopes: input.scopes,
      proofDigest: input.proofDigest,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
    });
    return id;
  }

  /** The current, unrevoked, unexpired consent for a child. */
  async activeFor(childId: string) {
    const [row] = await this.db
      .select()
      .from(consents)
      .where(and(eq(consents.childId, childId), isNull(consents.revokedAt)))
      .orderBy(desc(consents.grantedAt))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    return row;
  }

  async activeForChildren(childIds: string[]): Promise<Set<string>> {
    if (childIds.length === 0) return new Set();
    const rows = await this.db
      .select({ childId: consents.childId, expiresAt: consents.expiresAt })
      .from(consents)
      .where(and(inArray(consents.childId, childIds), isNull(consents.revokedAt)));
    const now = new Date();
    return new Set(rows.filter((r) => !r.expiresAt || r.expiresAt > now).map((r) => r.childId));
  }

  async revokeFor(childId: string) {
    await this.db
      .update(consents)
      .set({ revokedAt: new Date() })
      .where(and(eq(consents.childId, childId), isNull(consents.revokedAt)));
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** Local day keys from Monday through `now`, inclusive. */
export function weekDayKeys(now: Date, timezone: string): string[] {
  const weekday = localWeekday(now, timezone);
  const daysSinceMonday = (weekday + 6) % 7;
  const keys: string[] = [];
  for (let back = daysSinceMonday; back >= 0; back--) {
    keys.push(localDayKey(new Date(now.getTime() - back * 86_400_000), timezone));
  }
  return keys;
}

export class UsageRepo {
  constructor(private readonly db: Database) {}

  async summary(childId: string, now: Date, timezone: string) {
    const keys = weekDayKeys(now, timezone);
    const today = localDayKey(now, timezone);
    const rows = await this.db
      .select()
      .from(usageDays)
      .where(and(eq(usageDays.childId, childId), inArray(usageDays.dayKey, keys)));

    let todayMinutes = 0;
    let weekMinutes = 0;
    for (const row of rows) {
      weekMinutes += row.minutes;
      if (row.dayKey === today) todayMinutes = row.minutes;
    }
    return { todayMinutes, weekMinutes };
  }

  /** Last `days` local days, oldest first -- what the parent dashboard charts. */
  async history(childId: string, now: Date, timezone: string, days = 14) {
    const keys: string[] = [];
    for (let back = days - 1; back >= 0; back--) {
      keys.push(localDayKey(new Date(now.getTime() - back * 86_400_000), timezone));
    }
    const rows = await this.db
      .select()
      .from(usageDays)
      .where(and(eq(usageDays.childId, childId), inArray(usageDays.dayKey, keys)));
    const byKey = new Map(rows.map((r) => [r.dayKey, r.minutes]));
    return keys.map((dayKey) => ({ dayKey, minutes: byKey.get(dayKey) ?? 0 }));
  }
}

// ---------------------------------------------------------------------------
// Learning progress
// ---------------------------------------------------------------------------

export class ProgressRepo {
  constructor(private readonly db: Database) {}

  /**
   * Fold one result into the child's rollup.
   *
   * `best` only ever improves, so a bad day cannot erase a good one -- which is
   * the behaviour a child expects from a high score, and the one a parent wants
   * from a progress chart.
   */
  async record(childId: string, appId: string, metric: ProgressMetric, value: number) {
    const higherIsBetter = METRIC_HIGHER_IS_BETTER[metric];
    await this.db
      .insert(activityProgress)
      .values({ childId, appId, metric, best: value, latest: value, attempts: 1 })
      .onConflictDoUpdate({
        target: [activityProgress.childId, activityProgress.appId, activityProgress.metric],
        set: {
          best: higherIsBetter
            ? sql`greatest(${activityProgress.best}, ${value})`
            : sql`least(${activityProgress.best}, ${value})`,
          latest: value,
          attempts: sql`${activityProgress.attempts} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  async forChild(childId: string) {
    return this.db
      .select()
      .from(activityProgress)
      .where(eq(activityProgress.childId, childId))
      .orderBy(desc(activityProgress.updatedAt));
  }

  async clearFor(childId: string) {
    await this.db.delete(activityProgress).where(eq(activityProgress.childId, childId));
  }
}

// ---------------------------------------------------------------------------
// Sessions -- the broker's persistence port
// ---------------------------------------------------------------------------

export class SessionRepo implements SessionStore {
  constructor(private readonly db: Database) {}

  async insert(session: Session): Promise<void> {
    await this.db.insert(sessions).values(toInsertRow(session));
  }

  async update(id: string, patch: Partial<Session>): Promise<void> {
    const row = toUpdateRow(patch);
    if (Object.keys(row).length === 0) return;
    await this.db.update(sessions).set(row).where(eq(sessions.id, id));
  }

  async byId(id: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row ? fromRow(row) : null;
  }

  async liveForChild(childId: string): Promise<Session | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.childId, childId), ne(sessions.state, 'terminated')))
      .limit(1);
    return row ? fromRow(row) : null;
  }

  async allLive(): Promise<Session[]> {
    const rows = await this.db.select().from(sessions).where(ne(sessions.state, 'terminated'));
    return rows.map(fromRow);
  }

  async addUsageMinutes(childId: string, dayKey: string, minutes: number): Promise<void> {
    // Upsert-and-add: concurrent heartbeats for the same child must not lose a
    // minute to a read-modify-write race.
    await this.db
      .insert(usageDays)
      .values({ childId, dayKey, minutes })
      .onConflictDoUpdate({
        target: [usageDays.childId, usageDays.dayKey],
        set: { minutes: sql`${usageDays.minutes} + ${minutes}` },
      });
  }

  /** How many sessions this child has ever had. Drives the first-run welcome. */
  async countFor(childId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(eq(sessions.childId, childId));
    return row?.count ?? 0;
  }

  async recentFor(childId: string, limit = 20) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.childId, childId))
      .orderBy(desc(sessions.createdAt))
      .limit(limit);
  }
}

type SessionInsert = typeof sessions.$inferInsert;

function toInsertRow(session: Session): SessionInsert {
  return {
    id: session.id,
    childId: session.childId,
    guardianId: session.guardianId,
    state: session.state,
    delivery: session.delivery,
    driverRef: session.driverRef,
    driverName: session.driverName,
    deviceKind: session.deviceKind,
    autoLaunchAppId: session.autoLaunchAppId,
    createdAt: session.createdAt,
    readyAt: session.readyAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    deadline: session.deadline,
    limitedBy: session.limitedBy,
    idleTimeoutMinutes: session.idleTimeoutMinutes,
    timezone: session.timezone,
    billedMinutes: session.billedMinutes,
    lastBilledAt: session.lastBilledAt,
    endpointHost: session.endpointHost,
    endpointPort: session.endpointPort,
    endpointSecret: session.endpointSecret,
  };
}

const SESSION_COLUMNS = [
  'state',
  'delivery',
  'driverRef',
  'driverName',
  'deviceKind',
  'autoLaunchAppId',
  'readyAt',
  'lastHeartbeatAt',
  'endedAt',
  'endReason',
  'deadline',
  'limitedBy',
  'idleTimeoutMinutes',
  'timezone',
  'billedMinutes',
  'lastBilledAt',
  'endpointHost',
  'endpointPort',
  'endpointSecret',
] as const satisfies ReadonlyArray<keyof Session & keyof SessionInsert>;

/**
 * Build an UPDATE payload from a partial patch.
 *
 * Only keys actually present on the patch are copied. `undefined` means "leave
 * this column alone" while an explicit `null` means "clear it" -- collapsing
 * the two would blank out the endpoint on every heartbeat.
 */
function toUpdateRow(patch: Partial<Session>): Partial<SessionInsert> {
  const row: Partial<SessionInsert> = {};
  for (const key of SESSION_COLUMNS) {
    if (key in patch) Object.assign(row, { [key]: patch[key] });
  }
  return row;
}

function fromRow(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    childId: row.childId,
    guardianId: row.guardianId,
    state: row.state,
    delivery: row.delivery,
    driverRef: row.driverRef,
    driverName: row.driverName,
    deviceKind: row.deviceKind,
    autoLaunchAppId: row.autoLaunchAppId,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
    endedAt: row.endedAt,
    endReason: row.endReason,
    deadline: row.deadline,
    limitedBy: row.limitedBy,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    timezone: row.timezone,
    billedMinutes: row.billedMinutes,
    lastBilledAt: row.lastBilledAt,
    endpointHost: row.endpointHost,
    endpointPort: row.endpointPort,
    endpointSecret: row.endpointSecret,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export class AuditRepo {
  constructor(private readonly db: Database) {}

  /**
   * Fire-and-forget by design: an audit write must never be the reason a parent
   * cannot sign in. Failures are surfaced through the caller's logger instead.
   */
  async record(event: {
    actorType: 'guardian' | 'child' | 'system';
    actorId: string | null;
    action: AuditAction;
    subjectType?: 'guardian' | 'child' | 'session' | 'consent' | 'order' | null;
    subjectId?: string | null;
    meta?: Record<string, unknown>;
  }) {
    await this.db.insert(auditEvents).values({
      id: newId(ID_PREFIX.audit),
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      subjectType: event.subjectType ?? null,
      subjectId: event.subjectId ?? null,
      meta: event.meta ?? {},
    });
  }

  async forSubject(subjectType: string, subjectId: string, limit = 100) {
    return this.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.subjectType, subjectType), eq(auditEvents.subjectId, subjectId)))
      .orderBy(desc(auditEvents.at))
      .limit(limit);
  }
}

export interface Repos {
  progress: ProgressRepo;
  guardians: GuardianRepo;
  refreshTokens: RefreshTokenRepo;
  children: ChildRepo;
  policies: PolicyRepo;
  consents: ConsentRepo;
  usage: UsageRepo;
  sessions: SessionRepo;
  audit: AuditRepo;
}

export function createRepos(db: Database): Repos {
  return {
    progress: new ProgressRepo(db),
    guardians: new GuardianRepo(db),
    refreshTokens: new RefreshTokenRepo(db),
    children: new ChildRepo(db),
    policies: new PolicyRepo(db),
    consents: new ConsentRepo(db),
    usage: new UsageRepo(db),
    sessions: new SessionRepo(db),
    audit: new AuditRepo(db),
  };
}
