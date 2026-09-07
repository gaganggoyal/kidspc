import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AGE_BANDS,
  AGE_BAND_SPECS,
  CATALOG,
  PLANS,
  PRODUCT_NAME,
  type PlanId,
  TRIAL_PLAN_ID,
  appsForBand,
  challengeForWeek,
  deliveryOf,
  extraChildPriceInr,
  discountPercent,
  findApp,
  formatInr,
  localApps,
  planById,
  trialDaysFor,
} from '@kidpc/shared';
import { getTokens } from '../api';
import { currentReferral } from '../referral';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { HowItWorks } from './HowItWorks';
import { PlanRequest } from './PlanRequest';
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
  // Someone arrived on another parent's link. Said once at the top and again on
  // the form, because a promise made only at the point of payment reads like a
  // sales tactic rather than a gift from a friend.
  const referralCode = currentReferral();
  // The headline trial is Lite's, because Lite is the only plan that has one.
  // Pro streams a Linux desktop, and a free fortnight of that is a bill.
  const trialPlan = planById(TRIAL_PLAN_ID);
  const trialDays = trialDaysFor(trialPlan, { referred: Boolean(referralCode) });
  const challenge = challengeForWeek(new Date());
  const challengeApp = findApp(challenge.appId);
  // Which plan's request form is open, if any. One at a time: two forms on a
  // pricing page is two half-filled forms.
  const [requesting, setRequesting] = useState<PlanId | null>(null);
  const activities = localApps(CATALOG);

  return (
    <div className="home">
      {referralCode && (
        <div className="invited-bar">
          You were invited by another parent, so your {trialPlan.name} trial is {trialDays} days
          instead of {trialPlan.trialDays}.
        </div>
      )}
      <SiteHeader home />

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
            {/*
              The preview leads, and the trial follows it. A parent cannot
              decide anything from a feature list, and the activities cost us a
              static file to serve -- so the cheapest thing we own is also the
              most persuasive, and putting it second was leaving it unused.
            */}
            <Link to="/try" className="btn primary big">
              Try it free — no sign-up
            </Link>
            <Link to={signedIn ? '/household' : '/signin?new=1'} className="btn big">
              {signedIn ? 'Go to your household' : `Start ${trialDays} days free`}
            </Link>
          </div>
          <ul className="trust">
            <li>{trialDays} days free</li>
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

      {challengeApp && (
        <section className="home-section">
          <div className="challenge-card">
            <span className="cert-label">This week&apos;s challenge</span>
            <h2>{challenge.title}</h2>
            <p className="challenge-prompt">{challenge.prompt}</p>
            <p className="small muted">{challenge.grownUp}</p>
            <div className="row">
              <Link to={`/try/${challenge.appId}`} className="btn primary">
                Do it in {challengeApp.name}
              </Link>
              <span className="small muted">
                A new one every Monday. The same one for every family — nothing here watches your
                child to decide what to suggest.
              </span>
            </div>
          </div>
        </section>
      )}

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
        {/* Each tile is a way in, not a description. Reading about Paint and
            then being able to open Paint is the shortest path there is from
            interest to a child asking for more of it. */}
        <div className="promo-grid">
          {activities.map((app) => (
            <Link className="promo-tile try-tile" key={app.id} to={`/try/${app.id}`}>
              <span className="glyph" aria-hidden="true">
                {CATEGORY_GLYPH[app.category] ?? '✨'}
              </span>
              <h3>{app.name}</h3>
              <p className="muted">{app.tagline}</p>
              <p className="small muted">
                From age {AGE_BAND_SPECS[app.minBand].minAge} · <span className="try-cue">Play it now</span>
              </p>
            </Link>
          ))}
        </div>
      </section>

      <HowItWorks />

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


      <section className="band" id="plans">
        <div className="home-section">
          <h2>Choose a plan</h2>
          <p className="lede">
            {trialPlan.name} starts with {trialDays} free days, so you can find out whether your
            child actually uses it before you decide anything. Pro has no trial — it runs a real
            computer on our hardware from the first day.
          </p>

          <div className="plans">
            {PLANS.map((plan) => {
              // Derived from the catalogue, not listed by hand: a new activity
              // lands in the right tier without anyone editing a price table.
              const apps = CATALOG.filter((app) => plan.includes.includes(deliveryOf(app.launch)));
              return (
                <article className={plan.recommended ? 'plan recommended' : 'plan'} key={plan.id}>
                  {plan.recommended && <span className="plan-badge">Best value</span>}
                  <h3>{plan.name}</h3>
                  <p className="muted plan-tagline">{plan.tagline}</p>

                  <p className="price">
                    {formatInr(plan.offerPriceInr)}
                    <span className="per"> / month</span>
                  </p>
                  <p className="was">
                    <s>{formatInr(plan.listPriceInr)}</s>{' '}
                    <span className="save">Launch offer, save {discountPercent(plan)}%</span>
                  </p>

                  <p className="plan-household">
                    Up to {plan.includedChildren} children included · each extra child{' '}
                    {formatInr(extraChildPriceInr(plan))}/month
                  </p>

                  {/* Said on the card rather than once at the top of the
                      section, because it is the one thing that differs between
                      these two and a reader comparing them will not scroll back
                      up to find out. */}
                  <p className={plan.trialDays > 0 ? 'plan-trial' : 'plan-trial none'}>
                    {plan.trialDays > 0
                      ? `${trialDaysFor(plan, { referred: Boolean(referralCode) })} days free first`
                      : 'No free trial — billed from the start'}
                  </p>

                  <ul className="plan-feats">
                    <li>
                      <strong>{apps.length} activities</strong> — {apps.map((a) => a.name).join(', ')}
                    </li>
                    {plan.extras.map((extra) => (
                      <li key={extra}>{extra}</li>
                    ))}
                  </ul>

                  {plan.pending && <p className="plan-pending">{plan.pending}</p>}

                  {requesting === plan.id ? (
                    <PlanRequest plan={plan} onClose={() => setRequesting(null)} />
                  ) : (
                    <button
                      className={plan.recommended ? 'primary big' : 'big'}
                      onClick={() => setRequesting(plan.id)}
                    >
                      Choose {plan.name}
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          <p className="small muted plans-note">
            Nothing is charged yet. There is no payment system connected to this service and we do
            not ask for a card — the prices are here so you know what they will be. Pro&apos;s
            streamed desktop is still being built. The activities themselves are{' '}
            <Link to="/try">free to try right now</Link>, with no account at all.
          </p>
        </div>
      </section>

      <section className="home-section">
        <div className="refer-card">
          <div>
            <h2>Give a month, get a month</h2>
            <p className="muted">
              Every household has a link to share. A family who joins on yours starts{' '}
              {trialPlan.name} with {trialDaysFor(trialPlan, { referred: true })} free days
              instead of {trialPlan.trialDays}, and once they stay, your next month is on us.
            </p>
            <p className="small muted">
              Parents share it, never children. There is no friend list, no profile anyone else
              can see, and nothing your child can send to anybody.
            </p>
          </div>
          <div className="stack">
            {signedIn ? (
              <Link to="/parent#refer" className="btn primary big">
                Get your link
              </Link>
            ) : (
              <Link to="/signin?new=1" className="btn primary big">
                Create an account
              </Link>
            )}
            <span className="small muted">Your link lives in the parent dashboard.</span>
          </div>
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

      <SiteFooter />
    </div>
  );
}
