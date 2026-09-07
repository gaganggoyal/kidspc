import { Link } from 'react-router-dom';
import {
  CONTACT_EMAIL,
  GOVERNING_LAW,
  GRIEVANCE_OFFICER,
  JURISDICTION,
  LEGAL_ENTITY,
  MAX_CHILDREN,
  PLANS,
  POLICIES_UPDATED,
  PRODUCT_NAME,
  REFUND_WINDOW_DAYS,
  TRIAL_PLAN_ID,
  formatInr,
  planById,
  trialDaysFor,
  whoWeAre,
} from '@kidpc/shared';
import { Prose } from './SiteChrome';

/**
 * The four policy documents.
 *
 * Written from what the code actually does rather than from a template, which
 * is the only reason they are worth reading: the privacy policy below lists the
 * columns that exist in the database, and nothing else, because a policy that
 * describes a different product is worse than no policy at all.
 *
 * Every figure -- prices, trial lengths, the refund window, the household size
 * -- comes from the domain rather than being typed in. A policy page quoting a
 * stale price is a policy page that contradicts the pricing page, and of the
 * two the customer will reasonably rely on this one.
 *
 * All four live in one file because they share a voice, a last-updated date and
 * a set of cross-references, and keeping them together is what stops one of
 * them being revised while the other three quietly disagree with it.
 */

/** Who the customer is contracting with, said the same way in every document. */
function Operator() {
  return LEGAL_ENTITY ? (
    <>
      <strong>{LEGAL_ENTITY}</strong>
    </>
  ) : (
    <>
      {PRODUCT_NAME}, operated by {whoWeAre()}
    </>
  );
}

function Ask() {
  return (
    <p>
      Anything here that is unclear is our fault, not yours. Write to{' '}
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or use the{' '}
      <Link to="/contact">contact page</Link>, and a person will answer.
    </p>
  );
}

// ---------------------------------------------------------------------------

export function Terms() {
  const lite = planById(TRIAL_PLAN_ID);
  const pro = planById('pro');

  return (
    <Prose
      title="Terms of service"
      lede="What you can expect from us, and what we need from you."
      updated={POLICIES_UPDATED}
    >
      <h2>1. Who you are dealing with</h2>
      <p>
        This service is <Operator />. These terms are governed by {GOVERNING_LAW}, and the courts
        of {JURISDICTION} have jurisdiction over any dispute arising from them.
      </p>

      <h2>2. What the service is</h2>
      <p>
        {PRODUCT_NAME} is a subscription that turns a browser you already own — on a television,
        laptop, tablet or phone — into a supervised computer for a child. It provides a set of
        learning activities, a profile for each child in a household, and the controls a parent
        uses to decide when and for how long those profiles can be used.
      </p>
      <p>
        Some activities run entirely in your own browser. {pro.name} additionally provides a Linux
        desktop streamed from our servers. <strong>{pro.name} is not open yet</strong>; it is
        listed and priced so that you know what it will cost, and this is stated on the pricing
        page as well as here.
      </p>

      <h2>3. Accounts</h2>
      <ul>
        <li>
          A parent account may only be created by an adult of 18 or over who is the parent or
          legal guardian of the children added to it.
        </li>
        <li>
          You are responsible for what happens under your account, including keeping your password
          to yourself. A child&apos;s four-digit code is not a password and is not intended to keep
          anyone out but a sibling — do not rely on it as security.
        </li>
        <li>
          A household covers up to {MAX_CHILDREN} children. The price depends on how many, and is
          shown before you commit to anything.
        </li>
      </ul>

      <h2>4. Children, and why a profile may not open</h2>
      <p>
        Indian law requires verifiable parental consent before a child&apos;s personal data may be
        processed. Until we have verified you are the parent or guardian of a child on your
        account, that child&apos;s profile cannot be used. This is not a setting you can turn off
        and it is not something we will make an exception about.
      </p>
      <p>
        We tell you this before you pay, on the home page and in the welcome email, because finding
        it out afterwards would be a reason to want your money back.
      </p>

      <h2>5. Acceptable use</h2>
      <p>Do not use {PRODUCT_NAME} to:</p>
      <ul>
        <li>create a profile for a child who is not in your care;</li>
        <li>
          share one household&apos;s subscription across several households — the per-child price
          exists so that you do not have to;
        </li>
        <li>
          attempt to reach parts of the service you have not been given, interfere with other
          households, or use the activities to attack anything;
        </li>
        <li>resell, sublicense or rebrand the service.</li>
      </ul>
      <p>
        We may suspend an account that does any of these. Where we do, we will say why, and any
        unused portion of a paid month is refunded.
      </p>

      <h2>6. Plans, prices and billing</h2>
      <ul>
        {PLANS.map((plan) => (
          <li key={plan.id}>
            <strong>{plan.name}</strong> — {formatInr(plan.offerPriceInr)} per month during the
            launch offer ({formatInr(plan.listPriceInr)} thereafter), covering up to{' '}
            {plan.includedChildren} children, with each additional child at half the plan price.{' '}
            {plan.trialDays > 0
              ? `${plan.trialDays} days free before the first charge.`
              : 'No free trial; billed from the first month.'}
          </li>
        ))}
      </ul>
      <p>
        Prices are in Indian rupees and include any taxes we are required to charge. Subscriptions
        are monthly and renew until you cancel. We will always tell you by email before a price
        you are already paying changes, and you may cancel instead.
      </p>
      <p>
        <strong>There is currently no payment processing connected to this service.</strong> Nobody
        can be charged today. If you have asked for a plan, we have your request and will email you
        a payment link; see <Link to="/refunds">cancellations and refunds</Link> for what happens
        once that exists.
      </p>

      <h2>7. Trials</h2>
      <p>
        {lite.name} begins with {lite.trialDays} free days, or{' '}
        {trialDaysFor(lite, { referred: true })} if you arrived on another household&apos;s
        referral link. Cancel before the trial ends and nothing is taken. {pro.name} has no free
        trial, because every {pro.name} session runs a real computer on hardware we pay for from
        the first day.
      </p>

      <h2>8. What your child makes</h2>
      <p>
        Drawings, stories, code and anything else your child creates in an activity stay on the
        device they were made on. They belong to your household. We do not upload them, we cannot
        see them, and we claim no rights over them.
      </p>

      <h2>9. Availability</h2>
      <p>
        We do not promise the service will be available at every moment. It is run by a small team
        on a small number of machines, and it will occasionally be down for maintenance or because
        something has broken. We will not charge you for a month in which the service was
        substantially unavailable — write to us and we will sort it out.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may change these terms. If a change materially affects you — the price, what the plan
        includes, or how your data is handled — we will email you before it takes effect, and you
        may cancel. Continuing to use the service after that date means you accept the change.
      </p>

      <h2>11. Liability</h2>
      <p>
        {PRODUCT_NAME} is a supervision tool, not a substitute for supervision. We do our best to
        keep the catalogue safe and the controls working, but you remain responsible for what your
        child does with a computer. To the extent the law allows, our total liability to you for
        any claim is limited to the amount you paid us in the twelve months before it arose.
      </p>
      <p>
        Nothing here limits any right you have under the Consumer Protection Act 2019 or any other
        law that cannot be contracted out of.
      </p>

      <Ask />
    </Prose>
  );
}

// ---------------------------------------------------------------------------

export function Privacy() {
  return (
    <Prose
      title="Privacy policy"
      lede="What we hold, why we hold it, and how to make us delete it."
      updated={POLICIES_UPDATED}
    >
      <p>
        This describes what the software actually stores, not what a policy template says a service
        like this might store. Where you see a list below, that list is the whole list.
      </p>
      <p>
        The data fiduciary is <Operator />, contactable at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>What we collect</h2>

      <h3>About you, the parent</h3>
      <ul>
        <li>Your email address, and a cryptographic hash of your password — never the password.</li>
        <li>The name you choose to be called by.</li>
        <li>Your timezone, so that &quot;an hour a day&quot; means a day where you live.</li>
        <li>When you created the account and when you last signed in.</li>
      </ul>

      <h3>About each child</h3>
      <ul>
        <li>A first name, or whatever name you choose to type.</li>
        <li>
          <strong>Birth month and year only</strong> — not a date of birth. It is used to decide
          which activities suit them and to unlock the next set on a birthday.
        </li>
        <li>The avatar you picked, and a hash of their four-digit code.</li>
      </ul>

      <h3>About their use of the service</h3>
      <ul>
        <li>Minutes used per day, so the limits you set can be enforced.</li>
        <li>
          When sessions started and ended, on what kind of device, and which activity they opened.
        </li>
        <li>
          Personal bests — a number per activity per measure, such as words per minute or puzzles
          solved.
        </li>
      </ul>

      <h3>If you ask to subscribe, or write to us</h3>
      <ul>
        <li>
          Your email address, optionally a name, which plan and how many children, the price we
          quoted, and a referral code if you arrived on one.
        </li>
        <li>Messages you send through the contact form, so that we can reply.</li>
      </ul>

      <h2>What we never collect</h2>
      <ul>
        <li>
          <strong>Anything your child makes.</strong> Drawings, stories and code stay on the device.
          They are never uploaded and we cannot see them.
        </li>
        <li>
          <strong>No advertising, ever.</strong> There is no advertising in this product and no
          setting that could switch one on.
        </li>
        <li>
          <strong>No behavioural profile of a child.</strong> Nothing here watches a child to work
          out what to suggest to them — the weekly challenge is the same for every household in the
          country, chosen by the calendar. Section 9 of the Digital Personal Data Protection Act
          2023 prohibits tracking, behavioural monitoring and targeted advertising directed at
          children, and this service is built so that none of it is possible rather than merely
          switched off.
        </li>
        <li>
          <strong>No third-party analytics or trackers.</strong> There is no analytics script, no
          advertising pixel, and no social media embed on any page. Nothing on this site loads code
          from a company that would learn you had visited.
        </li>
        <li>No payment card details. We have never held any and cannot.</li>
      </ul>

      <h2>Why we are allowed to hold it</h2>
      <p>
        For your own account: because you asked us to provide the service, and consented when you
        created it. For a child&apos;s data: only with the verifiable consent of their parent or
        guardian, which is why a child profile cannot be used before that consent is verified. You
        may withdraw consent at any time, which means deleting the account.
      </p>

      <h2>Who else sees it</h2>
      <p>
        Nobody buys it, and nobody is given it. The only third parties involved at all are the ones
        needed to run the service: the company hosting our servers, and our email provider, who
        handles the messages we send you. Neither is given data for any purpose of their own. We
        will disclose data if a law or a court in {JURISDICTION} requires it, and where we are
        permitted to tell you that we have, we will.
      </p>

      <h2>Cookies and what is stored in your browser</h2>
      <ul>
        <li>
          One cookie, used to keep you signed in. It is not used to follow you anywhere and there
          is no advertising or analytics cookie on this site.
        </li>
        <li>
          Some things are kept in your browser&apos;s own storage and never sent to us: scores from
          the free preview, a referral code if you arrived on a link, and any name typed onto a
          &quot;show a grown-up&quot; card. Clearing your browser data removes all of it.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        Account and child data for as long as the account exists. When you delete your account it is
        removed, including every child profile, all usage history and all progress. Records we are
        required to keep for tax or accounting — an invoice, for instance — are kept for as long as
        the law requires and no longer.
      </p>

      <h2>Your rights, and how to use them without asking us</h2>
      <ul>
        <li>
          <strong>Get a copy.</strong> The parent dashboard has a button that downloads everything
          we hold about your household, immediately, as a file.
        </li>
        <li>
          <strong>Delete it.</strong> The same screen has a button that deletes the account and
          everything in it. No email, no waiting, no retention period.
        </li>
        <li>
          <strong>Correct it.</strong> Names, birth months, limits and permissions are all editable
          on that screen.
        </li>
        <li>
          <strong>Complain.</strong> Write to {GRIEVANCE_OFFICER.name},{' '}
          {GRIEVANCE_OFFICER.role}, at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If
          you are not satisfied with the response you may complain to the Data Protection Board of
          India.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Passwords and children&apos;s codes are stored as hashes and never in a form we could read
        back. Consent is recorded as a digest of the proof rather than the proof itself. Traffic is
        encrypted in transit. We keep the amount of data small on purpose, because the safest record
        is the one that was never collected.
      </p>

      <h2>Changes</h2>
      <p>
        If we change what we collect or why, we will email every account holder before the change
        takes effect. The date at the top of this page tells you when the wording last moved.
      </p>

      <Ask />
    </Prose>
  );
}

// ---------------------------------------------------------------------------

export function Refunds() {
  const lite = planById(TRIAL_PLAN_ID);
  const pro = planById('pro');

  return (
    <Prose
      title="Cancellations and refunds"
      lede="Cancel whenever you like, from your own dashboard, without writing to anybody."
      updated={POLICIES_UPDATED}
    >
      <h2>Cancelling</h2>
      <p>
        A subscription is monthly and you may cancel at any time. There is no notice period, no
        cancellation fee, and no retention offer to sit through. The service continues until the end
        of the month you have already paid for, and then stops.
      </p>

      <h2>During a trial</h2>
      <p>
        {lite.name} starts with {lite.trialDays} free days ({trialDaysFor(lite, { referred: true })}{' '}
        if you arrived on another household&apos;s referral link). Cancel before the trial ends and
        you are charged nothing at all. We will not take a payment on the last day of a trial
        without having emailed you first.
      </p>
      <p>
        {pro.name} has no free trial, because a {pro.name} session runs a real computer on hardware
        we pay for from the first day. The {REFUND_WINDOW_DAYS}-day guarantee below applies to it
        instead.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>
          <strong>Within {REFUND_WINDOW_DAYS} days of your first charge</strong> — write to us and
          we refund it in full, no questions and no conditions.
        </li>
        <li>
          <strong>After that</strong> — cancelling stops the next charge. The month already paid for
          runs to its end and is not normally refunded, because you have had the service for it.
        </li>
        <li>
          <strong>If the service was substantially unavailable</strong>, or if we suspended your
          account, or if we charged you after you cancelled — we refund the affected month in full.
          Tell us and we will not argue about it.
        </li>
        <li>
          <strong>If a child profile could not be used</strong> because we had not yet verified you
          as their parent, and you did not get what you paid for as a result — full refund.
        </li>
      </ul>

      <h2>How a refund reaches you</h2>
      <p>
        Refunds go back to the payment method they came from. Once we have approved one it is
        submitted the same working day; how long it takes to appear is up to your bank, and is
        usually five to seven working days. We will email you when it has been sent.
      </p>

      <h2>How to ask</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address the
        subscription is under, or use the <Link to="/contact">contact page</Link>. Say what you want
        refunded. You do not need to explain why.
      </p>

      <h2>Today</h2>
      <p>
        <strong>No payment processing is connected to this service yet</strong>, so nobody has been
        charged and there is nothing to refund. This page describes what will happen from the day
        that changes, and it is published now so that it is not written after the first
        disagreement.
      </p>

      <Ask />
    </Prose>
  );
}

// ---------------------------------------------------------------------------

export function Delivery() {
  const pro = planById('pro');

  return (
    <Prose
      title="How the service is delivered"
      lede="There is nothing to ship. It is a web address, and it works the moment you sign in."
      updated={POLICIES_UPDATED}
    >
      <h2>Nothing is posted to you</h2>
      <p>
        {PRODUCT_NAME} is a digital service. There is no hardware, no disc, no courier and no
        delivery address. Nothing will ever arrive at your home, and no shipping charge exists.
      </p>

      <h2>When it starts working</h2>
      <ul>
        <li>
          <strong>Immediately.</strong> A parent account works the moment you create it, and the
          activities open in the browser you created it in.
        </li>
        <li>
          <strong>On any device.</strong> The same account works on a television, a laptop, a tablet
          and a phone. There is nothing to install, though you may add it to a home screen if you
          would like an icon.
        </li>
        <li>
          <strong>Across India.</strong> The service is offered to households in {JURISDICTION}. It
          needs nothing but a browser and an internet connection.
        </li>
      </ul>

      <h2>Before a child profile will open</h2>
      <p>
        A child&apos;s profile becomes usable once we have verified that you are their parent or
        guardian, which Indian law requires. Everything else — your account, your household, the
        limits you set — works from the first minute. We say this before you pay rather than after.
      </p>

      <h2>{pro.name}</h2>
      <p>
        {pro.name} additionally streams a Linux desktop from our servers. It is not open yet. When
        it is, a session is provisioned on demand, within about a minute of a child pressing start,
        and nothing is installed on your device for that either.
      </p>

      <h2>If it does not work</h2>
      <p>
        Tell us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. A service you cannot
        reach is a service you did not receive, and{' '}
        <Link to="/refunds">the refunds page</Link> says what happens then.
      </p>

      <Ask />
    </Prose>
  );
}
