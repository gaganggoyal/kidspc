/**
 * API client.
 *
 * The access token is held in memory only -- never localStorage. A TV in a
 * living room is a shared device, and a token that survives a page reload also
 * survives the next person to pick up the remote. Continuity comes from the
 * httpOnly refresh cookie instead, which JavaScript cannot read at all.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** Already written for a parent or child to read. Safe to show as-is. */
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}: ${userMessage}`);
    this.name = 'ApiError';
  }
}

type Tokens = { guardian: string | null; child: string | null };

const tokens: Tokens = { guardian: null, child: null };
const listeners = new Set<() => void>();

export function setGuardianToken(token: string | null): void {
  tokens.guardian = token;
  // Signing a guardian out must not leave a child token behind on the device.
  if (!token) tokens.child = null;
  listeners.forEach((fn) => fn());
}

export function setChildToken(token: string | null): void {
  tokens.child = token;
  listeners.forEach((fn) => fn());
}

export function getTokens(): Readonly<Tokens> {
  return tokens;
}

export function onTokenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  as?: 'guardian' | 'child' | 'none';
  /** Internal: stops a refresh loop from recursing. */
  retried?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, as = 'guardian' } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = as === 'child' ? tokens.child : as === 'guardian' ? tokens.guardian : null;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`/v1${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && as === 'guardian' && !options.retried) {
    // One silent refresh attempt. If it fails, the caller sees the 401 and
    // sends the user back to sign-in rather than retrying forever.
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, { ...options, retried: true });
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'unknown_error',
      err?.message ?? 'Something went wrong.',
      err?.details ?? {},
    );
  }
  return payload as T;
}

let refreshInFlight: Promise<boolean> | null = null;

export function tryRefresh(): Promise<boolean> {
  // Several components can 401 at once on a cold load; they should share one
  // refresh rather than each rotating the token out from under the others.
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setGuardianToken(null);
        return false;
      }
      const { accessToken } = (await res.json()) as { accessToken: string };
      setGuardianToken(accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface GuardianDto {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  createdAt: string;
}

export interface PolicyDto {
  childId: string;
  dailyMinutes: number;
  weeklyMinutes: number | null;
  allowedWindows: Array<{ days: number[]; start: string; end: string }>;
  allowedAppIds: string[];
  sessionSummaries: boolean;
  idleTimeoutMinutes: number;
}

export interface ChildDto {
  id: string;
  displayName: string;
  avatarId: string;
  birthYear: number;
  birthMonth: number;
  band: 'explorer' | 'builder' | 'coder';
  age: number;
  consentGranted: boolean;
  archivedAt: string | null;
  policy: PolicyDto;
  usageTodayMinutes: number;
}

export interface HouseholdDto {
  guardian: GuardianDto;
  children: ChildDto[];
  bands: Record<string, { id: string; label: string; minAge: number; maxAge: number; blurb: string }>;
}

export type Delivery = 'local' | 'hosted';

export interface SessionDto {
  id: string;
  childId: string;
  state: string;
  delivery: Delivery;
  deadline: string;
  grantedMinutes: number;
  remainingMinutes: number;
  autoLaunchAppId: string | null;
  /** Streaming gateway path. Null for local activities. */
  streamPath: string | null;
  /** Client route to open. Null for streamed desktops. */
  localRoute: string | null;
}

export interface HomeDto {
  child: { id: string; displayName: string; avatarId: string; band: string };
  bandSpec: { label: string; blurb: string };
  apps: Array<{
    id: string;
    name: string;
    tagline: string;
    category: string;
    delivery: Delivery;
  }>;
  /** False on a lite deployment, where only local activities are offered. */
  desktopsAvailable: boolean;
  /** True until this child has had their first session. */
  firstRun: boolean;
  time: { dailyMinutes: number; usedTodayMinutes: number; remainingMinutes: number };
  canStart: boolean;
  blocked: { reason: string; message: string; retryAt: string | null } | null;
  summariesEnabled: boolean;
  session: SessionDto | null;
}
