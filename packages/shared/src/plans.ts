import { type Delivery } from './catalog.js';

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
    tagline: 'Everything a child needs on the family TV.',
    listPriceInr: 999,
    offerPriceInr: 299,
    includes: ['local'],
    extras: [
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
 * Rupees, grouped the Indian way -- 1,99,999 rather than 199,999. Whole rupees
 * only: every price here is an integer, and trailing `.00` on a price tag reads
 * like a form field.
 */
export function formatInr(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)}`;
}
