import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, type SessionDto, api } from '../api';

export type ProgressMetric =
  | 'score'
  | 'level'
  | 'accuracy_pct'
  | 'words_per_minute'
  | 'words_written'
  | 'puzzles_solved'
  | 'minutes_practised';

export interface ActivityApi {
  /**
   * Report a result. Numbers only, by design -- a child's own words, drawings
   * and code stay on their device and are never sent anywhere.
   */
  report: (metric: ProgressMetric, value: number) => void;
  /** Personal best for a metric, if the server has one. */
  best: (metric: ProgressMetric) => number | null;
}

const HEARTBEAT_MS = 30_000;

/**
 * The frame every local activity runs inside.
 *
 * It owns the session -- starting it, keeping it alive, showing the countdown,
 * and ending it when time runs out -- so an activity is only ever a game. That
 * separation is what stops six activities each inventing their own slightly
 * wrong idea of when a child's time is up.
 */
export function ActivityShell({
  appId,
  title,
  children,
}: {
  appId: string;
  title: string;
  children: (api: ActivityApi) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDto | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const bests = useRef<Map<string, number>>(new Map());

  const leave = useCallback(() => navigate('/kid'), [navigate]);

  // ---- session -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Reuse a running session rather than starting a second one: a child
        // switching between activities should not spend two leases.
        const current = await api<SessionDto | null>('/sessions/current', { as: 'child' });
        const live =
          current && current.state !== 'terminated'
            ? current
            : await api<SessionDto>('/sessions', {
                method: 'POST',
                as: 'child',
                body: { appId, deviceKind: 'tv' },
              });
        if (cancelled) return;
        setSession(live);
        setRemaining(live.remainingMinutes);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.userMessage : 'Could not start.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    void api<{ progress: Array<{ appId: string; metric: string; best: number }> }>('/progress', {
      as: 'child',
    })
      .then(({ progress }) => {
        for (const row of progress) {
          if (row.appId === appId) bests.current.set(row.metric, row.best);
        }
      })
      .catch(() => {
        // A missing personal best is a cosmetic loss, never a reason to stop
        // a child from playing.
      });
  }, [appId]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const beat = async () => {
      if (stopped) return;
      try {
        const view = await api<SessionDto>(`/sessions/${session.id}/heartbeat`, {
          method: 'POST',
          as: 'child',
        });
        setRemaining(view.remainingMinutes);
        if (view.state === 'terminated') {
          stopped = true;
          setEnding("That's all your time for today.");
        }
      } catch {
        // A dropped beat is usually a blip; the next one catches up.
      }
    };
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session]);

  /** Local tick so the number moves between heartbeats. */
  useEffect(() => {
    if (remaining === null) return;
    const timer = setInterval(
      () => setRemaining((m) => (m === null ? null : Math.max(0, m - 1))),
      60_000,
    );
    return () => clearInterval(timer);
  }, [remaining !== null]);

  // ---- leaving -------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A TV remote's back button arrives as one of these. Escape is the
      // desktop equivalent; Backspace outside a text field is the browser's.
      const isBack =
        event.key === 'Escape' ||
        event.key === 'GoBack' ||
        event.key === 'BrowserBack' ||
        (event.key === 'Backspace' &&
          !(event.target as HTMLElement | null)?.matches?.('input, textarea, [contenteditable]'));
      if (isBack) {
        event.preventDefault();
        leave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leave]);

  const activityApi: ActivityApi = {
    report: (metric, value) => {
      const previous = bests.current.get(metric);
      if (previous === undefined || value > previous) bests.current.set(metric, value);
      void api('/progress', {
        method: 'POST',
        as: 'child',
        body: { appId, metric, value: Math.round(value * 100) / 100 },
      }).catch(() => {
        // Progress is a nice-to-have. Never interrupt play for it.
      });
    },
    best: (metric) => bests.current.get(metric) ?? null,
  };

  if (error) {
    return (
      <div className="tv">
        <div className="page stack">
          <div className="notice bad">{error}</div>
          <button className="primary" onClick={leave}>
            Back to my apps
          </button>
        </div>
      </div>
    );
  }

  const low = remaining !== null && remaining <= 5;

  return (
    <div className="tv activity">
      <header className="activity-bar">
        <button onClick={leave} aria-label="Back to my apps">
          ← Back
        </button>
        <h1>{title}</h1>
        <span className={`clock ${low ? 'low' : ''}`} aria-live="polite">
          {remaining === null ? '…' : remaining === 0 ? 'Time is up' : `${remaining} min left`}
        </span>
      </header>

      <main className="activity-body">
        {ending ? (
          <div className="stack" style={{ textAlign: 'center', maxWidth: '30ch', margin: 'auto' }}>
            <h2>{ending}</h2>
            <button className="primary" onClick={leave}>
              Back to my apps
            </button>
          </div>
        ) : session ? (
          children(activityApi)
        ) : (
          <div className="skeleton" style={{ width: '90%', height: '70%' }} />
        )}
      </main>
    </div>
  );
}
