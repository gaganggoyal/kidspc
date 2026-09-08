import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, type SessionDto, api } from '../api';
import { useSessionClock } from '../session';
import { useBackKey } from '../tv';

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
  const { remaining, sync } = useSessionClock();
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
        sync(live.remainingMinutes);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.userMessage : 'Could not start.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, sync]);

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
        sync(view.remainingMinutes);
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
  }, [session, sync]);

  useBackKey(leave);

  /*
   * One object for the life of the mount.
   *
   * The games hold this in dependency lists -- Block Puzzles runs its program
   * from an effect that depends on it -- so a fresh object every render meant
   * every heartbeat tore that effect down and rebuilt it, restarting the timer
   * mid-run. Nothing inside it needs to change: the bests are a ref and the
   * appId is fixed for the mount, so the identity may as well be fixed too.
   */
  const activityApi = useMemo<ActivityApi>(
    () => ({
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
    }),
    [appId],
  );

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
