import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { challengeForWeek, findApp } from '@kidpc/shared';
import { ApiError, type HomeDto, type SessionDto, api, setChildToken } from '../api';
import { useAutoFocusFirst, useSpatialNavigation } from '../tv';
import { glyphFor, shelve, TileFace, tileStyle } from './AppTile';
import { AVATARS } from './Household';
import { Welcome } from './Welcome';
import { formatMetric, headlineBests, type Headline, METRIC_LABEL } from '../play/metrics';
import { preloadGames } from '../play/games';

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
  // Their own bests, one per tile. Nobody else's: there is no leaderboard,
  // and the only record worth beating is the one they set last time.
  const [bests, setBests] = useState<Record<string, Headline>>({});
  // "Surprise me": which tile the roulette is lit on while it spins.
  const [rolling, setRolling] = useState<string | null>(null);
  const spin = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Once the tiles are drawn, fetch the games behind them, so OK opens one at
  // once instead of after a download.
  const appIds = home?.apps.map((app) => app.id).join(',') ?? '';
  useEffect(() => {
    if (appIds) preloadGames(appIds.split(','));
  }, [appIds]);

  useEffect(() => {
    api<{ progress: Array<{ appId: string; metric: string; best: number }> }>('/progress', {
      as: 'child',
    })
      .then(({ progress }) => setBests(headlineBests(progress)))
      // A missing trophy is cosmetic; never a reason to show an error.
      .catch(() => {});
    return () => {
      if (spin.current) clearInterval(spin.current);
    };
  }, []);

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

  /**
   * Light up tiles at random, slowing to a stop, then open the one it lands
   * on. A second of suspense is most of the fun of a dice; the choice itself
   * is made before the first frame, so the spin is only theatre.
   */
  const surprise = () => {
    const pool = (home?.apps ?? []).filter((app) => app.delivery !== 'hosted');
    if (pool.length === 0 || rolling || starting) return;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    let step = 0;
    const steps = 14;
    const tick = () => {
      step++;
      if (step >= steps) {
        if (spin.current) clearInterval(spin.current);
        spin.current = null;
        setRolling(pick.id);
        setTimeout(() => {
          setRolling(null);
          void start(pick.id);
        }, 450);
        return;
      }
      setRolling(pool[Math.floor(Math.random() * pool.length)]!.id);
    };
    spin.current = setInterval(tick, 90);
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
  const challenge = challengeForWeek(new Date());
  const challengeApp = home.apps.find((app) => app.id === challenge.appId);
  const resumeApp = home.session?.autoLaunchAppId
    ? findApp(home.session.autoLaunchAppId)
    : undefined;
  const locked = !home.canStart || starting !== null;

  return (
    <div className="tv stage">
      <div className="page stack launcher">
        <header className="stage-top">
          <div className="who">
            <span className="who-avatar" style={tileStyle(home.child.avatarId)} aria-hidden="true">
              {AVATARS[home.child.avatarId] ?? '🦊'}
            </span>
            <div>
              <h1>Hi {home.child.displayName}!</h1>
              <div className="muted small">{home.bandSpec.label}</div>
            </div>
          </div>
          <div className="row stage-top-actions">
            <TimeRing time={time} />
            <button
              onClick={() => {
                setChildToken(null);
                navigate('/household');
              }}
            >
              Not me
            </button>
          </div>
        </header>

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

        {/*
          Everything below is where a remote starts: the hero's button, then
          the shelves. The header above it -- including "Not me" -- is one
          deliberate press up, never the first thing OK does.
        */}
        <main className="stack launcher" data-focus-root>
          {/*
            The big card at the top: carry on with what was open, or else this
            week's prompt -- and the prompt only when this child is actually
            allowed to open the activity it needs, because a challenge a parent
            has switched off is a child asking why they cannot do the thing on the
            screen.

            No streak, no counter of weeks missed, and nothing that turns red on
            Sunday. It is a suggestion that quietly becomes a different suggestion
            on Monday.
          */}
          {home.session ? (
            <section className="hero-card" style={tileStyle(resumeApp?.id ?? 'resume')}>
              <div className="hero-copy">
                <span className="hero-eyebrow">Still going</span>
                <h2>{resumeApp ? resumeApp.name : 'Your session'}</h2>
                <p>Pick up exactly where you left off.</p>
                <button
                  className="primary"
                  onClick={() =>
                    navigate(home.session!.localRoute ?? `/kid/session/${home.session!.id}`)
                  }
                >
                  Carry on ▶
                </button>
              </div>
              <span className="hero-glyph" aria-hidden="true">
                {resumeApp ? glyphFor(resumeApp) : '▶️'}
              </span>
            </section>
          ) : challengeApp ? (
            <section className="hero-card" style={tileStyle(challengeApp.id)}>
              <div className="hero-copy">
                <span className="hero-eyebrow">This week</span>
                <h2>{challenge.title}</h2>
                <p>{challenge.prompt}</p>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => void start(challenge.appId)}
                    disabled={locked}
                  >
                    Try it in {challengeApp.name}
                  </button>
                  <SurpriseButton onPress={surprise} rolling={rolling !== null} disabled={locked} />
                </div>
              </div>
              <span className="hero-glyph" aria-hidden="true">
                {glyphFor(challengeApp)}
              </span>
            </section>
          ) : (
            <div className="row">
              <SurpriseButton onPress={surprise} rolling={rolling !== null} disabled={locked} />
            </div>
          )}

          {shelve(home.apps).map((shelf) => (
            <section className="shelf" key={shelf.id} aria-label={shelf.title}>
              <h2>{shelf.title}</h2>
              <div className="tile-grid">
                {shelf.apps.map((app) => (
                  <button
                    key={app.id}
                    className={rolling === app.id ? 'tile rolling' : 'tile'}
                    style={tileStyle(app.id)}
                    onClick={() => void start(app.id)}
                    disabled={locked}
                  >
                    <TileFace
                      app={app}
                      note={
                        starting === app.id ? (
                          <span className="tile-badge">Starting…</span>
                        ) : app.delivery === 'hosted' ? (
                          <span className="tile-badge" title="Opens on the big computer">
                            big computer
                          </span>
                        ) : bests[app.id] ? (
                          <span className="tile-badge best" title={METRIC_LABEL[bests[app.id]!.metric]}>
                            🏆 {formatMetric(bests[app.id]!.metric, bests[app.id]!.best)}
                          </span>
                        ) : null
                      }
                    />
                  </button>
                ))}
              </div>
            </section>
          ))}

          {/* Only offered where there is a desktop to open. On a lite deployment
              the local activities are the whole product, and a button that always
              failed would be worse than no button. */}
          {home.desktopsAvailable && (
            <button onClick={() => void start()} disabled={locked}>
              Just open the desktop
            </button>
          )}
        </main>
      </div>
    </div>
  );
}

function SurpriseButton({
  onPress,
  rolling,
  disabled,
}: {
  onPress: () => void;
  rolling: boolean;
  disabled: boolean;
}) {
  return (
    <button className="surprise" onClick={onPress} disabled={disabled || rolling}>
      <span aria-hidden="true">🎲</span> {rolling ? 'Rolling…' : 'Surprise me!'}
    </button>
  );
}

/**
 * Today's time, as a ring that empties.
 *
 * The most consequential number on a child's screen, and a ring is how every
 * child already reads "how much is left" -- a battery, a phone's timer, a pie.
 * The minutes are written inside it as well, because a ring is a picture and
 * "12 min" is a fact.
 */
function TimeRing({ time }: { time: HomeDto['time'] }) {
  const left =
    time.dailyMinutes > 0
      ? Math.max(0, Math.min(1, time.remainingMinutes / time.dailyMinutes))
      : 0;
  const state = time.remainingMinutes === 0 ? 'out' : time.remainingMinutes <= 10 ? 'low' : '';
  const r = 26;
  const around = 2 * Math.PI * r;
  return (
    <div
      className={`time-ring ${state}`}
      role="meter"
      aria-valuenow={time.usedTodayMinutes}
      aria-valuemin={0}
      aria-valuemax={time.dailyMinutes}
      aria-label="Screen time used today"
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="track" cx="32" cy="32" r={r} />
        <circle
          className="fill"
          cx="32"
          cy="32"
          r={r}
          strokeDasharray={around}
          strokeDashoffset={around * (1 - left)}
        />
      </svg>
      <span className="time-ring-text">
        <b>{time.remainingMinutes > 0 ? `${time.remainingMinutes} min` : 'No time'}</b>
        <span className="muted small">
          left today · {time.usedTodayMinutes} of {time.dailyMinutes} used
        </span>
      </span>
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
