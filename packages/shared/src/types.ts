import type { AgeBand } from './age.js';
import type {
  AllowedWindow,
  ConsentMethod,
  ConsentScope,
  SessionEndReason,
  SessionLimit,
  SessionState,
} from './schemas.js';

export interface Guardian {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  createdAt: Date;
}

export interface ChildProfile {
  id: string;
  guardianId: string;
  displayName: string;
  birthYear: number;
  birthMonth: number;
  avatarId: string;
  createdAt: Date;
  archivedAt: Date | null;
}

/** A child profile plus everything the UI needs to render and gate it. */
export interface ChildView extends ChildProfile {
  band: AgeBand;
  age: number;
  consentGranted: boolean;
  policy: ChildPolicy;
  usageTodayMinutes: number;
}

export interface ChildPolicy {
  childId: string;
  dailyMinutes: number;
  weeklyMinutes: number | null;
  allowedWindows: AllowedWindow[];
  allowedAppIds: string[];
  sessionSummaries: boolean;
  idleTimeoutMinutes: number;
  /**
   * The band this allow-list was last authored for.
   *
   * Without it we cannot tell "the parent switched this app off" from "this app
   * did not exist for the child yet", and a birthday would either re-grant
   * something a parent removed on purpose or silently unlock nothing at all.
   */
  grantedForBand: AgeBand;
  updatedAt: Date;
}

export interface ConsentRecord {
  id: string;
  guardianId: string;
  childId: string;
  method: ConsentMethod;
  scopes: ConsentScope[];
  /**
   * Salted hash of the verifier's proof. We keep enough to prove consent was
   * obtained and to re-check it against a fresh proof, and nothing that could
   * reconstruct the parent's identity document.
   */
  proofDigest: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface Session {
  id: string;
  childId: string;
  guardianId: string;
  state: SessionState;
  /** Opaque handle owned by the desktop driver (container id, VM id, ...). */
  driverRef: string | null;
  driverName: string;
  deviceKind: 'tv' | 'browser';
  autoLaunchAppId: string | null;
  createdAt: Date;
  readyAt: Date | null;
  lastHeartbeatAt: Date | null;
  endedAt: Date | null;
  endReason: SessionEndReason | null;

  /**
   * Hard stop from the policy engine, fixed when the session starts.
   * Re-deriving it later would let a mid-session policy edit extend a child's
   * time without a parent meaning to, so the grant is immutable once issued.
   */
  deadline: Date;
  /** Which limit set `deadline`, so the UI can say *why* time is running out. */
  limitedBy: SessionLimit;
  /** Idle ceiling copied from policy at start, for the same reason. */
  idleTimeoutMinutes: number;
  /**
   * Household timezone at start time. Denormalised so that which local day a
   * minute is billed to cannot shift under a session already in flight.
   */
  timezone: string;

  /** Minutes already written to the usage ledger for this session. */
  billedMinutes: number;
  /** Watermark for incremental billing; everything before this is banked. */
  lastBilledAt: Date;

  /** Where the streaming gateway reaches the desktop. Never sent to a client. */
  endpointHost: string | null;
  endpointPort: number | null;
  endpointSecret: string | null;
}

/** The safe projection of a session -- what a client is allowed to see. */
export interface SessionView {
  id: string;
  childId: string;
  state: SessionState;
  deadline: string;
  grantedMinutes: number;
  remainingMinutes: number;
  autoLaunchAppId: string | null;
  /** Relative URL of the streaming gateway, already scoped to this session. */
  streamPath: string | null;
}

export interface UsageDay {
  childId: string;
  /** Local `YYYY-MM-DD` in the guardian's timezone. */
  dayKey: string;
  minutes: number;
}

export type AuditAction =
  | 'guardian.register'
  | 'guardian.login'
  | 'guardian.login_failed'
  | 'child.create'
  | 'child.update'
  | 'child.archive'
  | 'child.login'
  | 'child.login_failed'
  | 'consent.challenge'
  | 'consent.grant'
  | 'consent.revoke'
  | 'policy.update'
  | 'session.start'
  | 'session.end'
  | 'session.denied'
  | 'data.export'
  | 'data.erase';

/**
 * Append-only accountability log. DPDP puts the burden of demonstrating lawful
 * processing on the fiduciary, so consent and access events are recorded even
 * when nothing went wrong.
 */
export interface AuditEvent {
  id: string;
  at: Date;
  actorType: 'guardian' | 'child' | 'system';
  actorId: string | null;
  action: AuditAction;
  subjectType: 'guardian' | 'child' | 'session' | 'consent' | null;
  subjectId: string | null;
  /** Operational detail only -- never behavioural profiling material. */
  meta: Record<string, unknown>;
}
