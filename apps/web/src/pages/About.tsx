import { Link } from 'react-router-dom';
import {
  CATALOG,
  FOUNDERS,
  PRODUCT_NAME,
  TRIAL_PLAN_ID,
  localApps,
  planById,
} from '@kidpc/shared';
import { Prose } from './SiteChrome';

/**
 * About us.
 *
 * Written as why this exists rather than as a company profile, because there is
 * no company profile worth reading yet -- two people and a server. What a
 * parent is deciding on this page is whether the people behind a thing their
 * child will use have thought about it, and a list of values does not answer
 * that. The specific decisions do.
 */
export function About() {
  const activities = localApps(CATALOG);
  const lite = planById(TRIAL_PLAN_ID);

  return (
    <Prose
      title="Why we built this"
      lede="Every family we know has the same argument, and none of the tools on the market are on the parent's side."
    >
      <p>
        A child needs a computer long before a family wants to buy one, and long before anybody
        wants to hand over an unsupervised browser. The devices that end up filling the gap — a
        parent&apos;s phone, an old laptop, a tablet with a games store on it — are all designed to
        keep a child on them for as long as possible. That is the business model. Screen time is
        the product being sold, and the child is what is being sold to.
      </p>
      <p>
        {PRODUCT_NAME} is the opposite trade. You pay us a small amount each month, and in return
        the computer stops when you said it should stop. There is nothing to maximise, because
        nothing is funded by attention. That is the whole idea, and every decision below follows
        from it.
      </p>

      <h2>What we decided, and why</h2>

      <h3>It runs on the screen you already own</h3>
      <p>
        Most Indian households already have a television with a browser in it. Add a Bluetooth
        keyboard and it is a first computer — no purchase, nothing to plug in, nothing to break.
        The {activities.length} activities run inside that browser, on your hardware, which is why
        we can afford to let anyone{' '}
        <Link to="/try">try all of them for free</Link> without an account.
      </p>

      <h3>The catalogue is small on purpose</h3>
      <p>
        {activities.map((a) => a.name).join(', ')} — and, on {planById('pro').name}, a real Linux
        desktop. There is no open app store to wander into. Every activity is something you would
        recognise as learning, and adding one is a decision somebody has to make and defend rather
        than a listing somebody uploads.
      </p>

      <h3>Nothing your child makes is uploaded</h3>
      <p>
        Drawings, stories and code stay on the device they were made on. We keep minutes used and
        personal bests, because a parent asked for both, and nothing else. We do not build a
        profile of a child, we do not show adverts, and there is no setting that could switch
        either of those on — the Digital Personal Data Protection Act 2023 prohibits both for
        children, and we would not want them anyway.
      </p>

      <h3>We say what is not built yet</h3>
      <p>
        {planById('pro').name}&apos;s streamed desktop is still in development, and it says so on
        the pricing page next to its price. Child profiles cannot be used until we can verify a
        parent, and that is on the home page rather than in an email after you sign up. We would
        rather lose the sale than have you find out afterwards.
      </p>

      <h2>Who we are</h2>
      <p>
        {PRODUCT_NAME} is built and run by{' '}
        {FOUNDERS.map((f, i) => (
          <span key={f.name}>
            {i > 0 && (i === FOUNDERS.length - 1 ? ' and ' : ', ')}
            <strong>{f.name}</strong> ({f.role})
          </span>
        ))}
        . It is a small operation, which is the reason a reply to{' '}
        <Link to="/contact">a message you send us</Link> comes from a person who can actually
        change the thing you are writing about.
      </p>

      <h2>Where we are going</h2>
      <p>
        The next three things, in order: verified parental consent, so children can actually use
        the profiles their parents have set up; payments, so {lite.name} subscriptions can start
        properly; and {planById('pro').name}&apos;s streamed desktop, which needs a machine of its
        own before it can be sold honestly.
      </p>
      <p>
        If you want to be told when each lands, start a {lite.name} trial or{' '}
        <Link to="/contact">write to us</Link> — we do not send marketing email, so it will be the
        only thing you hear from us.
      </p>
    </Prose>
  );
}
