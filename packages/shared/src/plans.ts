import { type Delivery } from './catalog.js';
import { REFERRAL_BONUS_DAYS } from './referral.js';

/**
 * What the plans cost.
 *
 * Prices live here rather than in the page that renders them, for the same
 * reason the catalogue does: a number typed into markup is a number nobody
 * finds when it changes, and a landing page quoting a stale price is worse than
 * one quoting none.
 *
 * `includes` is a delivery list, not a hand-written feature list. The apps each
 * plan offers are then derived from the catalogue, so adding an activity puts
 * it in the right tier automatically instead of relying on someone remembering
 * to update the pricing table too.
 *
 * There is no payment processing anywhere in this repository. Nobody can be
 * charged, and these figures are an announcement rather than a checkout.
 */
export const TRIAL_DAYS = 7;

/**
 * What each child beyond the included two costs, as a fraction of the plan's
 * monthly price. Held here rather than per plan because it is one commercial
 * decision -- half price for a sibling -- and two copies of it would eventually
 * disagree.
 */
export const EXTRA_CHILD_RATE = 0.5;

/** Households larger than this are a support conversation, not a form. */
export const MAX_CHILDREN = 8;

/**
 * How long after a first charge a household can change its mind and have the
 * money back in full.
 *
 * A commercial decision rather than a legal minimum -- India has no statutory
 * cooling-off period for a digital subscription. It lives here rather than in
 * the refunds page because a payment provider, a customer and whoever answers
 * the email all have to be told the same number.
 */
export const REFUND_WINDOW_DAYS = 7;

export const PLAN_IDS = ['lite', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Rupees per month, before the launch offer. */
  listPriceInr: number;
  /** Rupees per month, during the launch offer. */
  offerPriceInr: number;
  /** Children covered by the base price, before any per-child addition. */
  includedChildren: number;
  /**
   * Free days before the first charge. Zero means no trial at all.
   *
   * Per plan rather than global, because they genuinely differ: Lite runs in
   * the household's own browser and costs us nothing to give away for a week,
   * while a Pro trial would provision a Linux desktop -- real memory on a real
   * machine -- for someone who has paid nothing. A single TRIAL_DAYS constant
   * quietly promised the second one on every page that mentioned the first.
   */
  trialDays: number;
  /** Which delivery kinds this plan includes; the app list follows from it. */
  includes: readonly Delivery[];
  /** Points that are not simply "which apps", in the order they matter. */
  extras: readonly string[];
  recommended?: boolean;
  /**
   * Set when something the plan promises is not yet running.
   *
   * This is deliberately part of the plan rather than a footnote on the page.
   * A tier whose headline feature does not exist yet should not be able to be
   * rendered without saying so -- the type makes forgetting it a visible
   * omission rather than an invisible one.
   */
  pending?: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'lite',
    name: 'Lite',
    tagline: 'The household: a profile each, and limits that hold.',
    listPriceInr: 999,
    offerPriceInr: 299,
    includedChildren: 2,
    trialDays: TRIAL_DAYS,
    includes: ['local'],
    extras: [
      'A profile for each child, with their own PIN and their own progress',
      'Every parent control: daily and weekly limits, curfews, per-app permissions',
      'Runs in the browser your TV, laptop or tablet already has',
      'Works with the remote alone — no keyboard needed to get started',
      'Progress and personal bests for each child',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'A whole Linux computer, streamed to the same screen.',
    listPriceInr: 1999,
    offerPriceInr: 999,
    includedChildren: 2,
    // No trial. Every Pro session is a streamed Linux desktop on hardware we
    // pay for by the hour, so a free fortnight of it is a bill, not a sample.
    // Lite is the free way to find out whether a household will use this at
    // all, and it shares every activity that runs in the browser.
    trialDays: 0,
    includes: ['local', 'hosted'],
    recommended: true,
    extras: [
      'Everything in Lite',
      'A real desktop, streamed — nothing to install and nothing to break',
      'A locked-down browser that can only reach sites we have allowed',
      'Files that persist between sessions',
    ],
    pending:
      'The streamed desktop is still in development. Pro is priced and listed here, but not yet open.',
  },
];

/**
 * How many free days a household actually gets.
 *
 * The referral bonus extends a trial; it never creates one. Adding seven days
 * to a plan that offers none would hand out free streamed desktops to anyone
 * who pasted a code, which is the opposite of what the referral is for.
 */
export function trialDaysFor(plan: Plan, { referred = false }: { referred?: boolean } = {}): number {
  if (plan.trialDays === 0) return 0;
  return plan.trialDays + (referred ? REFERRAL_BONUS_DAYS : 0);
}

/** The plan whose trial the marketing pages talk about when none is named. */
export const TRIAL_PLAN_ID: PlanId = 'lite';

export function planById(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Whole-percent saving, rounded down so the claim is never overstated. */
export function discountPercent(plan: Plan): number {
  return Math.floor(((plan.listPriceInr - plan.offerPriceInr) / plan.listPriceInr) * 100);
}

/**
 * What a household pays each month.
 *
 * The base price covers `includedChildren`; each child beyond that adds
 * EXTRA_CHILD_RATE of it. Rounded to whole rupees at the last step rather than
 * per child, so three children cost what the page says rather than a rupee
 * either side of it.
 *
 * `offer` picks which base price to build on, so the launch discount applies to
 * the siblings too instead of quietly not applying.
 */
export function monthlyPriceInr(
  plan: Plan,
  children: number,
  { offer = true }: { offer?: boolean } = {},
): number {
  const base = offer ? plan.offerPriceInr : plan.listPriceInr;
  const extra = Math.max(0, children - plan.includedChildren);
  return Math.round(base * (1 + extra * EXTRA_CHILD_RATE));
}

/** The monthly cost of one additional child, at the price a household is on. */
export function extraChildPriceInr(plan: Plan, { offer = true }: { offer?: boolean } = {}): number {
  return Math.round((offer ? plan.offerPriceInr : plan.listPriceInr) * EXTRA_CHILD_RATE);
}

/**
 * Rupees, grouped the Indian way -- 1,99,999 rather than 199,999. Whole rupees
 * only: every price here is an integer, and trailing `.00` on a price tag reads
 * like a form field.
 */
export function formatInr(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}
