import { useEffect } from 'react';
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
import { GAMES, GameSlot } from '../play/games';
import { useSpatialNavigation } from '../tv';
import { glyphFor, shelve, TileFace, tileStyle } from './AppTile';
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

  /*
   * The arcade is the page a family is most likely to open on the television
   * itself -- type the address into the TV's browser and play -- so it answers
   * a remote the way the child's own launcher does. Off inside an activity,
   * where DemoShell runs its own and two would move focus twice per press.
   */
  useSpatialNavigation(!appId);
  useEffect(() => {
    if (appId) return;
    // Only on a set with no pointer at all. On a laptop a ring appearing on a
    // tile nobody chose is noise; on a television it is the only way to know
    // where the first press of an arrow will go.
    if (window.matchMedia?.('(pointer: none)').matches) {
      document.querySelector<HTMLElement>('[data-focus-root] a, [data-focus-root] button')?.focus();
    }
  }, [appId]);

  if (appId) {
    const app = findApp(appId);
    const Game = app ? GAMES[app.id] : undefined;
    if (!app || !Game) return <Navigate to="/try" replace />;
    return (
      <DemoShell appId={app.id} title={app.name}>
        {(activity) => <GameSlot Game={Game} activity={activity} />}
      </DemoShell>
    );
  }

  const challengeApp = findApp(challenge.appId);

  return (
    <div className="home stage arcade-page">
      <SiteHeader />

      <main data-focus-root>
        <section className="home-section try-head">
          <h1>The arcade</h1>
          <p className="lede">
            All {activities.length} games and activities, free, with no account and nothing to
            install. Nothing your child draws, writes or types here is uploaded — it stays in this
            browser.
          </p>
          <p className="small muted">
            On a TV? Use the remote: arrows to move, OK to play, Back to come out.
          </p>
        </section>

        {challengeApp && (
          <section className="home-section arcade-hero">
            <div className="hero-card" style={tileStyle(challengeApp.id)}>
              <div className="hero-copy">
                <span className="hero-eyebrow">This week&apos;s challenge</span>
                <h2>{challenge.title}</h2>
                <p>{challenge.prompt}</p>
                <p className="small hero-note">{challenge.grownUp}</p>
                <Link to={`/try/${challenge.appId}`} className="btn primary">
                  Start it in {challengeApp.name}
                </Link>
              </div>
              <span className="hero-glyph" aria-hidden="true">
                {glyphFor(challengeApp)}
              </span>
            </div>
          </section>
        )}

        {shelve(activities).map((shelf) => (
          <section className="home-section shelf" key={shelf.id} aria-label={shelf.title}>
            <h2>{shelf.title}</h2>
            <div className="tile-grid">
              {shelf.apps.map((app) => (
                <Link className="tile" key={app.id} to={`/try/${app.id}`} style={tileStyle(app.id)}>
                  <TileFace
                    app={app}
                    // Only where it narrows things: "from 5" on every tile of a
                    // product that starts at five says nothing nineteen times.
                    note={
                      app.minBand !== 'explorer' ? (
                        <span className="tile-badge">
                          Age {AGE_BAND_SPECS[app.minBand].minAge}+
                        </span>
                      ) : null
                    }
                  />
                </Link>
              ))}
            </div>
          </section>
        ))}

      </main>

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
