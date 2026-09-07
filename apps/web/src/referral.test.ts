import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureReferral, currentReferral } from './referral';

/**
 * The capture rule, tested without a browser.
 *
 * `referral.ts` touches `window` only inside its functions, so a stub is enough
 * and no DOM environment is needed. What is worth testing here is not
 * localStorage -- that is the platform's job -- but the two decisions this
 * module makes on its own: first code wins, and a store that throws must not
 * take the page with it.
 */
function stubStorage(initial: Record<string, string> = {}, throws = false) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    location: { search: '' },
    localStorage: {
      getItem(key: string) {
        if (throws) throw new Error('blocked');
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (throws) throw new Error('blocked');
        store.set(key, value);
      },
    },
  });
  return store;
}

describe('remembering who sent someone here', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('keeps a code off the URL, tidied up', () => {
    stubStorage();
    expect(captureReferral('?ref=kpc-o11abc')).toBe('KPC-011ABC');
    expect(currentReferral()).toBe('KPC-011ABC');
  });

  it('keeps the first code, not the latest', () => {
    stubStorage();
    captureReferral('?ref=KPC-AAAAAA');
    captureReferral('?ref=KPC-BBBBBB');
    // Otherwise anyone could append their own code to a link they post
    // publicly and take the credit for someone else's recommendation.
    expect(currentReferral()).toBe('KPC-AAAAAA');
  });

  it('ignores something that is not a code, and keeps looking', () => {
    stubStorage();
    expect(captureReferral('?ref=hello')).toBeNull();
    expect(captureReferral('?ref=KPC-AAAAAA')).toBe('KPC-AAAAAA');
  });

  it('returns nothing when there is no code and nothing stored', () => {
    stubStorage();
    expect(captureReferral('')).toBeNull();
    expect(currentReferral()).toBeNull();
  });

  it('survives a browser that refuses to store anything', () => {
    stubStorage({}, true);
    // A private window, or site data switched off. A referral is a nicety.
    expect(() => captureReferral('?ref=KPC-AAAAAA')).not.toThrow();
    expect(currentReferral()).toBeNull();
  });
});
