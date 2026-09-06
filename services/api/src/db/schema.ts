import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  AgeBand,
  AllowedWindow,
  Delivery,
  ConsentScope,
  EmailTemplate,
  OrderStatus,
  PlanId,
  SessionEndReason,
  SessionLimit,
  SessionState,
} from '@kidpc/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const guardians = pgTable(
  'guardians',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
    /** Set when the guardian asks for erasure; the row is purged by a job. */
    deletionRequestedAt: ts('deletion_requested_at'),
  },
  (t) => [uniqueIndex('guardians_email_key').on(sql`lower(${t.email})`)],
);

export const children = pgTable(
  'children',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    // Deliberately not a date column: we store year and month only.
    birthYear: integer('birth_year').notNull(),
    birthMonth: integer('birth_month').notNull(),
    avatarId: text('avatar_id').notNull().default('fox'),
    pinHash: text('pin_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
  },
  (t) => [index('children_guardian_idx').on(t.guardianId)],
);

export const consents = pgTable(
  'consents',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    scopes: jsonb('scopes').$type<ConsentScope[]>().notNull(),
    /** Salted digest of the verifier proof. The proof itself is never stored. */
    proofDigest: text('proof_digest').notNull(),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('consents_child_idx').on(t.childId)],
);

/** Short-lived record of a consent flow in progress. */
export const consentChallenges = pgTable('consent_challenges', {
  id: text('id').primaryKey(),
  guardianId: text('guardian_id')
    .notNull()
    .references(() => guardians.id, { onDelete: 'cascade' }),
  childId: text('child_id')
    .notNull()
    .references(() => children.id, { onDelete: 'cascade' }),
  method: text('method').notNull(),
  scopes: jsonb('scopes').$type<ConsentScope[]>().notNull(),
  nonce: text('nonce').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
});

export const policies = pgTable('policies', {
  childId: text('child_id')
    .primaryKey()
    .references(() => children.id, { onDelete: 'cascade' }),
  dailyMinutes: integer('daily_minutes').notNull(),
  weeklyMinutes: integer('weekly_minutes'),
  allowedWindows: jsonb('allowed_windows').$type<AllowedWindow[]>().notNull().default([]),
  allowedAppIds: jsonb('allowed_app_ids').$type<string[]>().notNull().default([]),
  sessionSummaries: boolean('session_summaries').notNull().default(false),
  grantedForBand: text('granted_for_band').$type<AgeBand>().notNull().default('explorer'),
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(12),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    guardianId: text('guardian_id').notNull(),
    state: text('state').$type<SessionState>().notNull(),
    delivery: text('delivery').$type<Delivery>().notNull().default('hosted'),
    driverRef: text('driver_ref'),
    driverName: text('driver_name').notNull(),
    deviceKind: text('device_kind').$type<'tv' | 'browser'>().notNull(),
    autoLaunchAppId: text('auto_launch_app_id'),

    createdAt: ts('created_at').notNull().defaultNow(),
    readyAt: ts('ready_at'),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    endedAt: ts('ended_at'),
    endReason: text('end_reason').$type<SessionEndReason>(),

    deadline: ts('deadline').notNull(),
    limitedBy: text('limited_by').$type<SessionLimit>().notNull(),
    idleTimeoutMinutes: integer('idle_timeout_minutes').notNull(),
    timezone: text('timezone').notNull(),

    billedMinutes: integer('billed_minutes').notNull().default(0),
    lastBilledAt: ts('last_billed_at').notNull(),

    endpointHost: text('endpoint_host'),
    endpointPort: integer('endpoint_port'),
    endpointSecret: text('endpoint_secret'),
  },
  (t) => [
    /**
     * One live desktop per child, enforced by the database rather than by
     * hope. The manager already collapses concurrent starts in-process, but
     * that guarantee dies the moment there are two API instances.
     */
    uniqueIndex('sessions_one_live_per_child')
      .on(t.childId)
      .where(sql`${t.state} <> 'terminated'`),
    index('sessions_live_idx').on(t.state),
  ],
);

export const usageDays = pgTable(
  'usage_days',
  {
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    /** Local `YYYY-MM-DD` in the household timezone. */
    dayKey: text('day_key').notNull(),
    minutes: integer('minutes').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.childId, t.dayKey] })],
);

export const activityProgress = pgTable(
  'activity_progress',
  {
    childId: text('child_id')
      .notNull()
      .references(() => children.id, { onDelete: 'cascade' }),
    appId: text('app_id').notNull(),
    metric: text('metric').notNull(),
    best: doublePrecision('best').notNull(),
    latest: doublePrecision('latest').notNull(),
    attempts: integer('attempts').notNull().default(1),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.childId, t.appId, t.metric] }),
    index('activity_progress_child_idx').on(t.childId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    guardianId: text('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('refresh_guardian_idx').on(t.guardianId)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('audit_subject_idx').on(t.subjectType, t.subjectId), index('audit_at_idx').on(t.at)],
);

/**
 * Queued outgoing mail. See migration 0002 for why it is a queue rather than an
 * SMTP call inside the request that caused it.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: text('id').primaryKey(),
    createdAt: ts('created_at').notNull().defaultNow(),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    template: text('template').$type<EmailTemplate>().notNull(),
    sentAt: ts('sent_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextTryAt: ts('next_try_at').notNull().defaultNow(),
  },
  (t) => [index('email_outbox_pending_idx').on(t.nextTryAt)],
);

/** A household asking to subscribe. Nothing is charged; see migration 0002. */
export const planOrders = pgTable(
  'plan_orders',
  {
    id: text('id').primaryKey(),
    createdAt: ts('created_at').notNull().defaultNow(),
    email: text('email').notNull(),
    contactName: text('contact_name'),
    planId: text('plan_id').$type<PlanId>().notNull(),
    children: integer('children').notNull(),
    quotedInr: integer('quoted_inr').notNull(),
    guardianId: text('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
    status: text('status').$type<OrderStatus>().notNull().default('requested'),
    note: text('note'),
  },
  (t) => [index('plan_orders_created_idx').on(t.createdAt)],
);
