import { normaliseReferralCode } from '@kidpc/shared';

/**
 * Remembering who sent someone here.
 *
 * A parent follows a link from a WhatsApp group, reads the page, shows the
 * preview to their child, comes back two evenings later and buys. The code has
 * to survive all of that, and it cannot live in the URL because the first thing
 * that happens is they navigate away from it.
 *
 * So it goes in localStorage -- on their own device, readable only by this
 * origin, sent to us exactly once and only if they choose to place an order.
 * There is no cookie, no fingerprint and no request made at the moment of
 * arrival: until somebody fills in the form, we do not know they came.
 */
const KEY = 'kidpc.ref';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private windows and blocked site data both throw here. A referral is a
    // nicety; never let it take the page down.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* see read() */
  }
}

/**
 * Pulls `?ref=` off the current URL and keeps it. Called once on boot.
 *
 * First code wins. Someone who arrives on their sister's link and later clicks
 * a stranger's stays attributed to their sister, which is both the fairer
 * answer and the one that cannot be gamed by appending a code to a link you
 * post publicly.
 */
export function captureReferral(search: string = window.location.search): string | null {
  const raw = new URLSearchParams(search).get('ref');
  if (raw) {
    const code = normaliseReferralCode(raw);
    if (code && !read(KEY)) write(KEY, code);
  }
  return read(KEY);
}

export function currentReferral(): string | null {
  return read(KEY);
}
