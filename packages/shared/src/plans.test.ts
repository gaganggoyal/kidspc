import { describe, expect, it } from 'vitest';
import {
  EXTRA_CHILD_RATE,
  PLANS,
  discountPercent,
  extraChildPriceInr,
  formatInr,
  monthlyPriceInr,
  planById,
} from './plans.js';

const lite = planById('lite');
const pro = planById('pro');

describe('household pricing', () => {
  it('charges the base price for the children the plan includes', () => {
    // The promise is "up to two children". One child must not cost less and two
    // must not cost more -- both are ways of quietly breaking that sentence.
    expect(monthlyPriceInr(lite, 1)).toBe(299);
    expect(monthlyPriceInr(lite, 2)).toBe(299);
    expect(monthlyPriceInr(pro, 1)).toBe(999);
    expect(monthlyPriceInr(pro, 2)).toBe(999);
  });

  it('adds half the plan price for each child beyond the second', () => {
    expect(monthlyPriceInr(lite, 3)).toBe(449); // 299 + 150 (rounded from 149.5)
    expect(monthlyPriceInr(lite, 4)).toBe(598); // 299 x 2
    expect(monthlyPriceInr(pro, 3)).toBe(1499); // 999 + 500 (rounded from 499.5)
    expect(monthlyPriceInr(pro, 4)).toBe(1998);
  });

  it('applies the launch discount to the extra children too', () => {
    // The alternative -- discounting the base and charging list for siblings --
    // is a thing pricing pages do by accident, and it makes the total on the
    // card disagree with the total in the email.
    expect(monthlyPriceInr(pro, 3, { offer: false })).toBe(2999);
    expect(monthlyPriceInr(pro, 3, { offer: true })).toBe(1499);
    expect(monthlyPriceInr(pro, 3)).toBeLessThan(monthlyPriceInr(pro, 3, { offer: false }));
  });

  it('never charges less than the base price, whatever it is given', () => {
    for (const plan of PLANS) {
      for (const children of [0, -1, 1, 2]) {
        expect(monthlyPriceInr(plan, children)).toBe(plan.offerPriceInr);
      }
    }
  });

  it('quotes the extra child at the same rate the total is built from', () => {
    for (const plan of PLANS) {
      const three = monthlyPriceInr(plan, 3);
      const two = monthlyPriceInr(plan, 2);
      // Rounding is applied to the total, so the advertised per-child price and
      // the difference between two totals can legitimately differ by a rupee.
      expect(Math.abs(three - two - extraChildPriceInr(plan))).toBeLessThanOrEqual(1);
    }
  });

  it('grows linearly, so a large household is never cheaper than a smaller one', () => {
    for (const plan of PLANS) {
      let previous = 0;
      for (let n = 1; n <= 8; n++) {
        const price = monthlyPriceInr(plan, n);
        expect(price).toBeGreaterThanOrEqual(previous);
        previous = price;
      }
    }
  });

  it('keeps the sibling rate at half', () => {
    expect(EXTRA_CHILD_RATE).toBe(0.5);
  });
});

describe('how prices are shown', () => {
  it('understates the discount rather than overstating it', () => {
    // Rounded down on purpose: an advertised "save 70%" that is really 69.97%
    // is a claim we cannot support, and the arithmetic is public.
    expect(discountPercent(lite)).toBe(70);
    expect(discountPercent(pro)).toBe(50);
    for (const plan of PLANS) {
      const real = ((plan.listPriceInr - plan.offerPriceInr) / plan.listPriceInr) * 100;
      expect(discountPercent(plan)).toBeLessThanOrEqual(real);
    }
  });

  it('groups rupees the Indian way', () => {
    expect(formatInr(999)).toBe('₹999');
    expect(formatInr(1999)).toBe('₹1,999');
    expect(formatInr(199999)).toBe('₹1,99,999');
  });

  it('shows whole rupees, never paise', () => {
    // Every price is an integer, but the rounding lives in monthlyPriceInr and
    // a regression there would surface here as a decimal on a price tag.
    for (const plan of PLANS) {
      for (let n = 1; n <= 8; n++) {
        expect(formatInr(monthlyPriceInr(plan, n))).not.toContain('.');
      }
    }
  });
});

describe('what each plan claims', () => {
  it('offers strictly more on Pro than on Lite', () => {
    expect(pro.includes).toEqual(expect.arrayContaining([...lite.includes]));
    expect(pro.includes.length).toBeGreaterThan(lite.includes.length);
  });

  it('marks Pro as not yet available, because it is not', () => {
    // The streamed desktop has never run. If this ever passes silently because
    // someone cleared the field, the pricing page starts selling something that
    // does not exist -- so the test is on the data, not on the page.
    expect(pro.pending).toBeTruthy();
    expect(lite.pending).toBeUndefined();
  });
});
