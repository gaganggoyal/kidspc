import {
  type AgeBand,
  type ChildPolicy,
  type ChildProfile,
  type ChildView,
  ageBandForBirth,
  ageInYears,
  errors,
} from '@kidpc/shared';
import { SessionManager } from '@kidpc/broker';
import type { Config } from './config.js';
import type { DatabaseHandle } from './db/client.js';
import type { Repos } from './repos.js';
import type { ConsentVerifier } from './consent/verifier.js';
import type { Mailer } from './email/mailer.js';
import type { Outbox } from './email/outbox.js';

/** Everything a route handler is allowed to reach. Assembled once at boot. */
export interface AppContext {
  config: Config;
  database: DatabaseHandle;
  repos: Repos;
  manager: SessionManager;
  consent: ConsentVerifier;
  mailer: Mailer;
  outbox: Outbox;
  now: () => Date;
}

/**
 * Load a child and everything needed to reason about them, checking ownership
 * on the way. Every parent-facing route goes through here rather than trusting
 * an id from the request: an authenticated guardian is not automatically
 * authorised for an arbitrary child.
 */
export async function loadChildForGuardian(
  ctx: AppContext,
  guardianId: string,
  childId: string,
): Promise<{ child: ChildProfile; policy: ChildPolicy; band: AgeBand | null }> {
  const row = await ctx.repos.children.byId(childId);
  if (!row || row.guardianId !== guardianId) {
    // Deliberately "not found" rather than "forbidden": a guardian should not
    // be able to probe which child ids exist.
    throw errors.notFound('Child');
  }
  const policy = await ctx.repos.policies.forChild(childId);
  if (!policy) throw errors.internal(`Child ${childId} has no policy row`);
  return {
    child: {
      id: row.id,
      guardianId: row.guardianId,
      displayName: row.displayName,
      birthYear: row.birthYear,
      birthMonth: row.birthMonth,
      avatarId: row.avatarId,
      createdAt: row.createdAt,
      archivedAt: row.archivedAt,
    },
    policy,
    band: ageBandForBirth({ birthYear: row.birthYear, birthMonth: row.birthMonth }, ctx.now()),
  };
}

/** Assemble the shape the parent dashboard and profile picker render from. */
export async function buildChildView(
  ctx: AppContext,
  child: ChildProfile,
  policy: ChildPolicy,
  consentGranted: boolean,
  timezone: string,
): Promise<ChildView> {
  const now = ctx.now();
  const birth = { birthYear: child.birthYear, birthMonth: child.birthMonth };
  const usage = await ctx.repos.usage.summary(child.id, now, timezone);
  return {
    ...child,
    band: ageBandForBirth(birth, now) ?? 'explorer',
    age: ageInYears(birth, now),
    consentGranted,
    policy,
    usageTodayMinutes: usage.todayMinutes,
  };
}
