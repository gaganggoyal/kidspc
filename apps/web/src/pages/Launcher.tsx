import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, type HomeDto, type SessionDto, api, setChildToken } from '../api';
import { useAutoFocusFirst, useSpatialNavigation } from '../tv';
import { AVATARS } from './Household';
import { Welcome } from './Welcome';

export const CATEGORY_GLYPH: Record<string, string> = {
  create: '🎨',
  code: '🧩',
  type: '⌨️',
  learn: '🧠',
  office: '📄',
  research: '🔎',
};

/**
 * The child's home screen.
 *
 * Everything it renders comes from one `/home` call: which apps to draw, how
 * much time is left, and whether starting is allowed. A TV on a weak connection
 * gets one round-trip to first paint rather than three.
 */
export function Launcher() {
  const navigate = useNavigate();
  const [home, setHome] = useState<HomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  // Dismissing the welcome is per-visit; the server decides whether it is a
  // first run at all, so this only covers "skip" within one sitting.
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  useSpatialNavigation();
  useAutoFocusFirst([home]);

  const load = useCallback(async () => {
    try {
      setHome(await api<HomeDto>('/home', { as: 'child' }));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setChildToken(null);
        navigate('/household');
        return;
      }
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not load your apps.');
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  // A child sitting on this screen when their window opens (or their budget
  // rolls over at midnight) should see it unlock without touching anything.
  useEffect(() => {
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const start = async (appId?: string) => {
    setStarting(appId ?? 'desktop');
    setError(null);
    try {
      const session = await api<SessionDto>('/sessions', {
        method: 'POST',
        as: 'child',
        body: { appId, deviceKind: 'tv' },
      });
      // Local activities are a route in this app; hosted ones are a stream.
      navigate(session.localRoute ?? `/kid/session/${session.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not start.');
      void load();
    } finally {
      setStarting(null);
    }
  };

  if (error && !home) {
    return (
      <div className="tv">
        <div className="page">
          <div className="notice bad">{error}</div>
        </div>
      </div>
    );
  }
  if (!home) {
    return (
      <div className="tv">
        <div className="page">
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      </div>
    );
  }

  if (home.firstRun && !welcomeDismissed && home.canStart) {
    return (
      <Welcome
        home={home}
        onPick={(appId) => void start(appId)}
        onSkip={() => setWelcomeDismissed(true)}
      />
    );
  }

  const { time } = home;
  const usedFraction = time.dailyMinutes > 0 ? time.usedTodayMinutes / time.dailyMinutes : 1;
  const barState = time.remainingMinutes === 0 ? 'out' : time.remainingMinutes <= 10 ? 'low' : '';

  return (
    <div className="tv">
      <div className="page stack">
        <div className="spread">
          <div className="row">
            <span style={{ fontSize: '2.4em' }} aria-hidden="true">
              {AVATARS[home.child.avatarId] ?? '🦊'}
            </span>
            <div>
              <h1 style={{ margin: 0 }}>Hi {home.child.displayName}!</h1>
              <div className="muted small">{home.bandSpec.label}</div>
            </div>
          </div>
          <button
            onClick={() => {
              setChildToken(null);
              navigate('/household');
            }}
          >
            Not me
          </button>
        </div>

        <div className="card stack">
          <div className="spread">
            <strong>
              {time.remainingMinutes > 0
                ? `${time.remainingMinutes} minutes left today`
                : 'No time left today'}
            </strong>
            <span className="muted small">
              {time.usedTodayMinutes} of {time.dailyMinutes} used
            </span>
          </div>
          <div
            className={`time-bar ${barState}`}
            role="meter"
            aria-valuenow={time.usedTodayMinutes}
            aria-valuemin={0}
            aria-valuemax={time.dailyMinutes}
            aria-label="Screen time used today"
          >
            <i style={{ width: `${Math.min(100, usedFraction * 100)}%` }} />
          </div>
        </div>

        {home.summariesEnabled && (
          <div className="notice small">
            A grown-up can see a summary of what you do in each session.
          </div>
        )}

        {home.blocked && (
          <div className="notice bad" role="status">
            <strong>{home.blocked.message}</strong>
            {home.blocked.retryAt && (
              <div className="small muted" style={{ marginTop: 6 }}>
                You can come back at {formatWhen(home.blocked.retryAt)}.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="notice bad" role="alert">
            {error}
          </div>
        )}

        {home.session ? (
          <button
            className="primary"
            onClick={() =>
              navigate(home.session!.localRoute ?? `/kid/session/${home.session!.id}`)
            }
          >
            Carry on where you left off
          </button>
        ) : null}

        <h2>Your apps</h2>
        <div className="app-grid">
          {home.apps.map((app) => (
            <button
              key={app.id}
              className="card app-tile"
              onClick={() => void start(app.id)}
              disabled={!home.canStart || starting !== null}
            >
              <span className="glyph" aria-hidden="true">
                {CATEGORY_GLYPH[app.category] ?? '✨'}
              </span>
              <span className="name">{app.name}</span>
              <span className="tagline">{app.tagline}</span>
              {app.delivery === 'hosted' && (
                <span className="badge" title="Opens on the big computer">
                  big computer
                </span>
              )}
              {starting === app.id && <span className="small muted">Starting…</span>}
            </button>
          ))}
        </div>

        {/* Only offered where there is a desktop to open. On a lite deployment
            the local activities are the whole product, and a button that always
            failed would be worse than no button. */}
        {home.desktopsAvailable && (
          <button onClick={() => void start()} disabled={!home.canStart || starting !== null}>
            Just open the desktop
          </button>
        )}
      </div>
    </div>
  );
}

/** "at 4:00 pm" / "tomorrow at 6:00 am" -- phrased for a child, not a log file. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86_400_000).toDateString() === at.toDateString();
  if (sameDay) return time;
  if (tomorrow) return `${time} tomorrow`;
  return `${at.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
}
