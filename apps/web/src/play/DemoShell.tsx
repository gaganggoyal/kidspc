import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { challengeForWeek } from '@kidpc/shared';
import type { ActivityApi } from './ActivityShell';
import { previewAchievements, previewBest, recordPreviewBest } from './previewProgress';
import { useBackKey } from '../tv';
import { ShowAGrownUp } from '../pages/ShowAGrownUp';

/**
 * The frame the public preview runs inside.
 *
 * A deliberate twin of ActivityShell, not a mode of it. The two shells have
 * opposite jobs -- one enforces a household's rules, the other has no household
 * to enforce -- and folding them together would have meant a session, a clock
 * and a set of limits all carrying an `if (demo)` past every line. The games
 * cannot tell the difference, which is the only thing that has to be true.
 *
 * What this shell does NOT have is as considered as what it does:
 *
 * - **No clock, and no cut-off.** Nothing counts down and nothing locks. Timing
 *   a child out of a free preview to sell a subscription is using a child to
 *   pressure their parent, and the home page promises we do not do that. The
 *   limits are the product; withholding them is not a sample of the product.
 * - **No modal.** The invitation below is a bar the child can dismiss, shown
 *   once, addressed to the adult. Nothing ever covers the game.
 * - **No account, no request, no beacon.** This shell makes no network calls at
 *   all. Serving it costs one static file, which is why it can be free.
 */
const INVITE_AFTER_MS = 3 * 60_000;

export function DemoShell({
  appId,
  title,
  children,
}: {
  appId: string;
  title: string;
  children: (api: ActivityApi) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showing, setShowing] = useState(false);
  const challenge = challengeForWeek(new Date());

  const leave = useCallback(() => navigate('/try'), [navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setInviting(true), INVITE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  // Disabled while the card is open, or Escape would close it and leave the
  // activity in one press.
  useBackKey(leave, !showing);

  // Stable for the life of the mount, for the reason ActivityShell's is: the
  // games treat this as a dependency, and a new object each render makes their
  // dependency lists mean nothing.
  const activityApi = useMemo<ActivityApi>(
    () => ({
      report: (metric, value) => recordPreviewBest(appId, metric, value),
      best: (metric) => previewBest(appId, metric),
    }),
    [appId],
  );

  return (
    <div className="tv activity">
      <header className="activity-bar">
        <button onClick={leave} aria-label="Back to the activities">
          ← Back
        </button>
        <h1>{title}</h1>
        <div className="row" style={{ gap: 8 }}>
          <span className="pill">Free preview</span>
          <button onClick={() => setShowing(true)}>Show a grown-up</button>
        </div>
      </header>

      <main className="activity-body">{children(activityApi)}</main>

      {inviting && !dismissed && (
        <aside className="invite-bar no-print">
          <p>
            Enjoying this? A household account gives each child their own profile, their own
            progress, and the daily limits you set.
          </p>
          <div className="row">
            <Link to="/#plans" className="btn primary">
              See the plans
            </Link>
            <button onClick={() => setDismissed(true)}>Not now</button>
          </div>
        </aside>
      )}

      <ShowAGrownUp
        open={showing}
        onClose={() => setShowing(false)}
        challenge={challenge}
        achievements={previewAchievements()}
        askForName
      />
    </div>
  );
}
