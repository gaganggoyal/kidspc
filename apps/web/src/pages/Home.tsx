import { Link } from 'react-router-dom';
import {
  AGE_BANDS,
  AGE_BAND_SPECS,
  CATALOG,
  PRODUCT_NAME,
  appsForBand,
  localApps,
} from '@kidpc/shared';
import { getTokens } from '../api';
import { CATEGORY_GLYPH } from './Launcher';

/**
 * The public home page.
 *
 * Everything factual here is read from the domain rather than retyped: the
 * activities come from CATALOG, the age ranges from AGE_BAND_SPECS. A landing
 * page that lists features by hand is a landing page that starts lying the
 * first time the catalogue changes, and marketing copy is exactly the surface
 * nobody thinks to update.
 *
 * Deliberately absent: prices, launch dates, testimonials and user counts.
 * None of those exist yet, and inventing them on the page a parent reads first
 * is not a trade worth making.
 */
export function Home() {
  /*
   * Deliberately NOT using useSpatialNavigation here, unlike every other
   * screen. That hook calls preventDefault on each arrow key to move focus by
   * geometry, which is right for a launcher grid that fits one screen. This
   * page is a long document with six focusable elements in five thousand
   * pixels: hijacking the arrows means a visitor cannot scroll it at all, and
   * pressing Down jumps from the hero straight past every paragraph.
   *
   * A D-pad scrolls this page, which is what a remote should do while someone
   * is reading. Tab and Enter still reach and press the buttons.
   */
  const signedIn = Boolean(getTokens().guardian);
  const activities = localApps(CATALOG);

  return (
    <div className="home">
      <header className="home-nav">
        <Link to="/" className="wordmark">
          <img src="/icon-192.png" alt="" width={36} height={36} />
          <span>{PRODUCT_NAME}</span>
        </Link>
        {signedIn ? (
          <Link to="/household" className="btn primary">
            Continue
          </Link>
        ) : (
          <Link to="/signin" className="btn">
            Parent sign in
          </Link>
        )}
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>
            A safe computer for your child,
            <br />
            on the TV you already own.
          </h1>
          <p className="lede">
            {PRODUCT_NAME} turns a smart TV, laptop or tablet into a place where children aged 5
            to 16 can draw, type, build and code. You decide how long, and when. There are no
            adverts and nothing to plug in.
          </p>
          <div className="row">
            <Link to={signedIn ? '/household' : '/signin?new=1'} className="btn primary big">
              {signedIn ? 'Go to your household' : 'Create a parent account'}
            </Link>
            <a href="#inside" className="btn big">
              See what&apos;s inside
            </a>
          </div>
          <ul className="trust">
            <li>No adverts</li>
            <li>No tracking</li>
            <li>No hardware to buy</li>
            <li>Delete your data any time</li>
          </ul>
        </div>

        {/* A television, drawn rather than photographed: no stock imagery of a
            child, which is the one thing a service for children should not use
            to sell itself. */}
        <div className="hero-art" aria-hidden="true">
          <div className="tv-frame">
            <div className="tv-screen">
              <div className="tv-greeting">Hi Meera! What shall we do first?</div>
              <div className="tv-grid">
                {activities.slice(0, 6).map((app) => (
                  <div className="tv-tile" key={app.id}>
                    <span className="glyph">{CATEGORY_GLYPH[app.category] ?? '✨'}</span>
                    <span>{app.name}</span>
                  </div>
                ))}
              </div>
              <div className="tv-clock">28 minutes left today</div>
            </div>
          </div>
          <div className="tv-stand" />
        </div>
      </section>

      <section className="band">
        <div className="home-section">
          <h2>Nothing to buy</h2>
          <p className="lede">
            Most families already own the screen. {PRODUCT_NAME} runs in the browser your
            television already has — on Fire TV, Samsung and LG — and on any laptop, tablet or
            phone. Add a Bluetooth keyboard and the family TV becomes a first computer.
          </p>
          <div className="tri">
            <div>
              <h3>Works with the remote</h3>
              <p className="muted">
                Arrow keys and OK are enough to choose a profile, enter a PIN and start playing.
              </p>
            </div>
            <div>
              <h3>Nothing to install</h3>
              <p className="muted">
                It is a web address. Open it, and add it to the home screen if you like the icon.
              </p>
            </div>
            <div>
              <h3>Picks up where it left off</h3>
              <p className="muted">
                Sign in once on the TV. After that a child only ever types four digits.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" id="inside">
        <h2>What your child gets</h2>
        <p className="lede">
          A small, deliberate catalogue — every activity is something you would recognise as
          learning. There is no open app store to wander into.
        </p>
        <div className="promo-grid">
          {activities.map((app) => (
            <article className="promo-tile" key={app.id}>
              <span className="glyph" aria-hidden="true">
                {CATEGORY_GLYPH[app.category] ?? '✨'}
              </span>
              <h3>{app.name}</h3>
              <p className="muted">{app.tagline}</p>
              <p className="small muted">
                From age {AGE_BAND_SPECS[app.minBand].minAge}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="home-section">
          <h2>What you control</h2>
          <div className="duo">
            <div>
              <h3>Time that actually runs out</h3>
              <p className="muted">
                Set minutes per day and per week. When the time is gone it is gone — the session
                ends on its own, so it is the computer saying no rather than you.
              </p>
            </div>
            <div>
              <h3>Only at the hours you choose</h3>
              <p className="muted">
                An after-school window on weekdays, a longer one on Sunday. Outside it, the
                profile simply will not open.
              </p>
            </div>
            <div>
              <h3>Only the activities you choose</h3>
              <p className="muted">
                Pick what each child can open. Sensible defaults for their age, and a birthday
                quietly unlocks the next set.
              </p>
            </div>
            <div>
              <h3>Put things right in one tap</h3>
              <p className="muted">
                Reset the limits, set a new PIN, clear the scores or stop a session — each on its
                own. Fixing a forgotten PIN should never wipe a year of progress.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section">
        <h2>Grows with them</h2>
        <p className="lede">
          Each age opens what suits it, and a birthday unlocks the next set without you doing
          anything. Nothing is ever taken away.
        </p>
        <div className="tri">
          {AGE_BANDS.map((id) => {
            const band = AGE_BAND_SPECS[id];
            // Listed from the catalogue rather than from the band's blurb: the
            // blurb describes the full product, including streamed desktop apps
            // this deployment does not serve. A landing page should promise what
            // this server can actually hand a child.
            const available = localApps(appsForBand(id));
            return (
              <div key={id}>
                <h3>
                  {band.label}{' '}
                  <span className="muted">
                    · {band.minAge}–{band.maxAge}
                  </span>
                </h3>
                <p className="muted">{available.map((a) => a.name).join(' · ')}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="band promise">
        <div className="home-section">
          <h2>What we will never do</h2>
          <div className="duo">
            <div>
              <h3>Never show your child an advert</h3>
              <p className="muted">
                Not a policy we could change later. There is no advertising in this product and no
                setting that could switch one on.
              </p>
            </div>
            <div>
              <h3>Never build a profile of your child</h3>
              <p className="muted">
                We keep minutes used and personal bests. What your child writes, draws and codes
                stays on your device and is never uploaded.
              </p>
            </div>
            <div>
              <h3>Never sell or share their data</h3>
              <p className="muted">
                We collect the least we can — a first name, and a birth month and year, so we know
                which activities suit them.
              </p>
            </div>
            <div>
              <h3>Never hold it hostage</h3>
              <p className="muted">
                Export everything we hold, or delete all of it, from the parent dashboard. No
                email, no waiting.
              </p>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 'var(--pad)' }}>
            Built to the Digital Personal Data Protection Act 2023, which is why a child&apos;s
            account needs a verified parent behind it.
          </p>
        </div>
      </section>

      <section className="home-section closing">
        <h2>Set it up once, this evening</h2>
        <p className="lede">
          Create your account, add your child, choose their minutes. It takes about five minutes,
          and it is free to set up.
        </p>
        <Link to={signedIn ? '/household' : '/signin?new=1'} className="btn primary big">
          {signedIn ? 'Go to your household' : 'Create a parent account'}
        </Link>
        <p className="small muted" style={{ marginTop: 'var(--pad)' }}>
          Parent accounts are open now. A child profile becomes usable once we can verify you are
          their parent or guardian — the law requires it, and we would rather say so here than
          after you have signed up.
        </p>
      </section>

      <footer className="home-foot">
        <span>{PRODUCT_NAME}</span>
        <Link to="/signin">Parent sign in</Link>
      </footer>
    </div>
  );
}
