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
  FOUNDERS,
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
import { glyphFor, tileStyle } from './AppTile';
import { Explainer } from './Explainer';
import { faqs } from '../faq';

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
  // The drawn television shows a mix -- two games among the things to make and
  // learn -- because that mix is the product, and six learning tiles in a row
  // undersold the half a child actually runs towards.
  const onScreen = ['snake', 'paint', 'fourrow', 'numbers', 'echo', 'blocks']
    .map((id) => activities.find((app) => app.id === id))
    .filter((app): app is (typeof activities)[number] => Boolean(app));

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
            to 16 can play, draw, type, build and code — every game works with the TV remote. You
            decide how long, and when. There are no adverts and nothing to plug in.
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
          <a className="watch-link" href="#tour">
            <span aria-hidden="true">▶</span> Watch how it works on a TV
          </a>
          <ul className="trust">
            <li>No adverts</li>
            <li>No chat or strangers</li>
            <li>No tracking</li>
            <li>Nothing to install</li>
            <li>Delete everything in one tap</li>
          </ul>
        </div>

        {/* A television, drawn rather than photographed: no stock imagery of a
            child, which is the one thing a service for children should not use
            to sell itself. */}
        <div className="hero-art" aria-hidden="true">
          <div className="tv-frame">
            <div className="tv-screen stage">
              <div className="tv-greeting">Hi Meera! What shall we play?</div>
              <div className="tv-grid">
                {onScreen.map((app) => (
                  <div className="tv-tile" key={app.id} style={tileStyle(app.id)}>
                    <span className="glyph">{glyphFor(app)}</span>
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

      <Explainer />

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
          A small, deliberate catalogue — games that ask for a plan, a memory or a strategy, and
          activities you would recognise as learning. There is no open app store to wander into.
        </p>
        {/* Each tile is a way in, not a description. Reading about Paint and
            then being able to open Paint is the shortest path there is from
            interest to a child asking for more of it. */}
        <div className="promo-grid">
          {activities.map((app) => (
            <Link className="promo-tile try-tile" key={app.id} to={`/try/${app.id}`}>
              <span className="glyph" aria-hidden="true">
                {glyphFor(app)}
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

      <section className="band" id="safety">
        <div className="home-section">
          <h2>The safest screen in your house</h2>
          <p className="lede">
            Built so the unsafe things are impossible, not merely switched off. There is no setting
            anywhere in {PRODUCT_NAME} that could turn any of these on.
          </p>
          <div className="safety-grid">
            {SAFETY.map((item) => (
              <div className="safety-item" key={item.title}>
                <span className="safety-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <h3>{item.title}</h3>
                <p className="muted">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="keep-grid">
            <div className="keep-card">
              <h3>What we keep</h3>
              <ul>
                <li>Your email address and the name you go by</li>
                <li>Your child&apos;s first name, and birth month and year — not the date</li>
                <li>Minutes used each day, so the limits work</li>
                <li>Their personal bests, so they have something to beat</li>
              </ul>
            </div>
            <div className="keep-card never">
              <h3>What we never keep</h3>
              <ul>
                <li>Anything your child draws, writes or codes — it never leaves your device</li>
                <li>Photos, voice, location or contacts</li>
                <li>A profile of what your child likes, to sell or to target</li>
                <li>Copies of the emails we send, once delivered</li>
              </ul>
            </div>
          </div>
          <p className="small muted" style={{ marginTop: 'var(--pad)' }}>
            Unconfirmed sign-ups are deleted within a day, and everything else on a published
            schedule — <Link to="/privacy">read exactly what and when</Link>. Built to India&apos;s
            Digital Personal Data Protection Act 2023, which is why a child&apos;s profile needs a
            verified parent behind it.
          </p>
        </div>
      </section>

      <section className="home-section" id="faq">
        <h2>Questions parents ask</h2>
        <div className="faq">
          {faqs().map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
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
        <p className="founders-line">
          Made in India by{' '}
          {FOUNDERS.map((f, i) => (
            <span key={f.name}>
              {i > 0 && ' and '}
              <strong>{f.name}</strong> <span className="muted">({f.role})</span>
            </span>
          ))}
          . <Link to="/about">Why we built it</Link>
        </p>
      </section>

      <SiteFooter />
    </div>
  );
}

/**
 * The guarantees, each one a thing that is true of the code rather than a
 * policy that could be changed. Where one depends on configuration outside
 * this file -- the camera and microphone rule is a response header set at the
 * edge -- it is the kind of configuration that is checked by preflight.
 */
const SAFETY = [
  {
    glyph: '🚫',
    title: 'No adverts, ever',
    body: 'Nothing here is paid for by attention, so there is nothing to show your child and nothing to maximise.',
  },
  {
    glyph: '💬',
    title: 'No chat, no strangers',
    body: 'Nobody can message your child and your child cannot message anybody. No friend lists, no public profiles.',
  },
  {
    glyph: '🌐',
    title: 'No open internet',
    body: 'Only the activities you tick. No open web browsing, no app store, no links out to anywhere else.',
  },
  {
    glyph: '📷',
    title: 'No camera or microphone',
    body: 'The site is forbidden from even asking for them, by the same browser rule banks use.',
  },
  {
    glyph: '🎨',
    title: 'Nothing is uploaded',
    body: 'Drawings, stories and code stay on your device. We could not see them if we wanted to.',
  },
  {
    glyph: '⏱️',
    title: 'Time that really ends',
    body: 'When today\u2019s minutes are gone, the session ends on its own — the computer says no, not you.',
  },
  {
    glyph: '👁️',
    title: 'No tracking',
    body: 'No analytics, no pixels, no third-party scripts. One cookie, only to keep you signed in.',
  },
  {
    glyph: '🗑️',
    title: 'Delete it all, in one tap',
    body: 'Download everything we hold, or erase it, from the parent dashboard. No email, no waiting.',
  },
] as const;
