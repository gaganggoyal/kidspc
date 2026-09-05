import { z } from 'zod';
import { AGE_BANDS } from './age.js';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected HH:MM in 24-hour form');

export const weekday = z.number().int().min(0).max(6);

export const ageBand = z.enum(AGE_BANDS);

/**
 * Password policy. Long-but-simple beats short-but-gnarly: parents type this on
 * a TV remote often enough that punctuation requirements actively hurt.
 */
export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long');

/** Child sign-in secret, entered on a D-pad. Four digits, never a password. */
export const childPin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const email = z.string().email().max(254).toLowerCase().trim();

/** E.164, the only phone shape we accept. */
export const phoneE164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Expected E.164, e.g. +919876543210');

// ---------------------------------------------------------------------------
// Guardian & auth
// ---------------------------------------------------------------------------

export const registerGuardianInput = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(80),
  timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
});
export type RegisterGuardianInput = z.infer<typeof registerGuardianInput>;

export const loginInput = z.object({ email, password: z.string().min(1).max(200) });
export type LoginInput = z.infer<typeof loginInput>;

// ---------------------------------------------------------------------------
// Consent (DPDP Act 2023 s.9 -- verifiable parental consent)
// ---------------------------------------------------------------------------

export const CONSENT_METHODS = ['digilocker', 'aadhaar_okyc', 'payment_instrument', 'dev_mock'] as const;
export const consentMethod = z.enum(CONSENT_METHODS);
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/**
 * Scopes are intentionally narrow and operational. There is no `analytics` or
 * `advertising` scope, and there never will be: DPDP Rules 2025 bar behavioural
 * tracking and targeted advertising to children regardless of consent, so the
 * capability simply does not exist in the model.
 */
export const CONSENT_SCOPES = [
  'account', // create and hold the child profile
  'progress', // store learning progress and usage minutes
  'session_summary', // retain per-session activity summaries for the parent
] as const;
export const consentScope = z.enum(CONSENT_SCOPES);
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const startConsentInput = z.object({
  childId: z.string().min(1),
  method: consentMethod,
  scopes: z.array(consentScope).min(1),
});

export const completeConsentInput = z.object({
  challengeId: z.string().min(1),
  /** Opaque proof from the verifier. Never persisted in the clear. */
  proof: z.string().min(1).max(4096),
});

// ---------------------------------------------------------------------------
// Child profiles
// ---------------------------------------------------------------------------

const currentYear = new Date().getUTCFullYear();

export const createChildInput = z.object({
  displayName: z.string().trim().min(1).max(40),
  birthYear: z.number().int().min(currentYear - 25).max(currentYear),
  birthMonth: z.number().int().min(1).max(12),
  avatarId: z.string().max(40).default('fox'),
  pin: childPin,
});
export type CreateChildInput = z.infer<typeof createChildInput>;

export const updateChildInput = createChildInput.partial().omit({ pin: true });

export const childLoginInput = z.object({
  childId: z.string().min(1),
  pin: childPin,
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const allowedWindow = z
  .object({
    /** Days this window applies to; empty means every day. */
    days: z.array(weekday).max(7).default([]),
    start: clockTime,
    end: clockTime,
  })
  .refine((w) => w.start !== w.end, { message: 'Window start and end must differ' });
export type AllowedWindow = z.infer<typeof allowedWindow>;

export const policyInput = z.object({
  /** Minutes of session time per local day. */
  dailyMinutes: z.number().int().min(0).max(24 * 60),
  /** Optional weekly cap, enforced on top of the daily cap. */
  weeklyMinutes: z.number().int().min(0).max(7 * 24 * 60).nullable().default(null),
  /** Empty list means "any time of day". */
  allowedWindows: z.array(allowedWindow).max(8).default([]),
  allowedAppIds: z.array(z.string().min(1)).max(64),
  /**
   * Parents can opt in to per-session activity summaries. Off by default:
   * surveillance of a child is a choice a parent makes explicitly, and the
   * child is always told when it is on.
   */
  sessionSummaries: z.boolean().default(false),
  /** Idle minutes before the session is suspended to free compute. */
  idleTimeoutMinutes: z.number().int().min(2).max(60).default(12),
});
export type PolicyInput = z.infer<typeof policyInput>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSION_STATES = [
  'provisioning',
  'ready',
  'active',
  'suspended',
  'terminated',
] as const;
export const sessionState = z.enum(SESSION_STATES);
export type SessionState = (typeof SESSION_STATES)[number];

/** Which limit produced a session's deadline. Drives the child-facing countdown label. */
export const SESSION_LIMITS = ['daily_budget', 'weekly_budget', 'window_end', 'max_session'] as const;
export const sessionLimit = z.enum(SESSION_LIMITS);
export type SessionLimit = (typeof SESSION_LIMITS)[number];

export const SESSION_END_REASONS = [
  'budget_exhausted',
  'outside_window',
  'idle_timeout',
  'child_ended',
  'parent_ended',
  'system_error',
  'shutdown',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const startSessionInput = z.object({
  /** Optional app to auto-launch once the desktop is up. */
  appId: z.string().min(1).optional(),
  deviceKind: z.enum(['tv', 'browser']).default('browser'),
});
