import { Link, Navigate, useParams } from 'react-router-dom';
import {
  AGE_BAND_SPECS,
  CATALOG,
  TRIAL_PLAN_ID,
  challengeForWeek,
  findApp,
  localApps,
  planById,
} from '@kidpc/shared';
import { DemoShell } from '../play/DemoShell';
import { GAMES } from '../play/games';
import { CATEGORY_GLYPH } from './Launcher';
import { SiteFooter, SiteHeader } from './SiteChrome';

/**
 * The public preview.
 *
 * Everything on this route is playable by anyone, immediately, with no account
 * and no data leaving the device. That is a commercial decision as much as a
 * technical one, and it is worth writing down because it looks like giving the
 * product away.
 *
 * It is not. What a household pays for is the household: a profile per child, a
 * PIN, limits that actually end the session, curfews, an allow-list, and
 * progress that survives a cleared browser and follows a child from the tablet
 * to the television. None of that can be demonstrated on a page, and all of it
 * is what a parent is actually buying.
 *
 * The activities, meanwhile, run entirely in the visitor's own browser and cost
 * us a static file to serve. Keeping them behind the sign-up wall bought us
 * nothing and cost us the only moment that matters -- the one where a child
 * looks up and asks for more of it. A parent who has watched that happen at
 * their kitchen table has already decided; a parent reading a feature list has
 * not started.
 */
export function TryIt() {
  const { appId } = useParams();
  const challenge = challengeForWeek(new Date());
  const activities = localApps(CATALOG);

  if (appId) {
    const app = findApp(appId);
    const Game = app ? GAMES[app.id] : undefined;
    if (!app || !Game) return <Navigate to="/try" replace />;
    return (
      <DemoShell appId={app.id} title={app.name}>
        {(activity) => <Game activity={activity} />}
      </DemoShell>
    );
  }

  const challengeApp = findApp(challenge.appId);

  return (
    <div className="home">
      <SiteHeader />

      <section className="home-section try-head">
        <h1>Try it now</h1>
        <p className="lede">
          All six activities, free, with no account and nothing to install. Nothing your child
          draws, writes or types here is uploaded — it stays in this browser.
        </p>
      </section>

      {challengeApp && (
        <section className="home-section">
          <div className="challenge-card">
            <span className="cert-label">This week&apos;s challenge</span>
            <h2>{challenge.title}</h2>
            <p className="challenge-prompt">{challenge.prompt}</p>
            <p className="small muted">{challenge.grownUp}</p>
            <Link to={`/try/${challenge.appId}`} className="btn primary big">
              Start it in {challengeApp.name}
            </Link>
          </div>
        </section>
      )}

      <section className="home-section">
        <h2>Or pick anything</h2>
        <div className="promo-grid">
          {activities.map((app) => (
            <Link className="promo-tile try-tile" key={app.id} to={`/try/${app.id}`}>
              <span className="glyph" aria-hidden="true">
                {CATEGORY_GLYPH[app.category] ?? '✨'}
              </span>
              <h3>{app.name}</h3>
              <p className="muted">{app.tagline}</p>
              <p className="small muted">From age {AGE_BAND_SPECS[app.minBand].minAge}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="home-section closing">
          <h2>What an account adds</h2>
          <p className="lede">
            The activities are the easy half. The half that makes a computer safe to hand a child
            is the part you cannot try on a page.
          </p>
          <div className="duo">
            <div>
              <h3>Time that runs out on its own</h3>
              <p className="muted">
                Minutes per day and per week, and hours of the day they apply. The session ends
                itself, so it is the computer saying no rather than you.
              </p>
            </div>
            <div>
              <h3>A profile for each child</h3>
              <p className="muted">
                Their own PIN, their own progress, their own list of what they may open — and it
                follows them from the tablet to the television.
              </p>
            </div>
          </div>
          <Link to="/#plans" className="btn primary big" style={{ marginTop: 'var(--pad)' }}>
            See the plans — {planById(TRIAL_PLAN_ID).name} is{' '}
            {planById(TRIAL_PLAN_ID).trialDays} days free
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
