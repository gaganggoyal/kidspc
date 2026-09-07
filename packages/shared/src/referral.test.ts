import { describe, expect, it } from 'vitest';
import { PLANS, planById, trialDaysFor } from './plans.js';
import {
  REFERRAL_BONUS_DAYS,
  normaliseReferralCode,
  referralCodeFor,
  referralInviteText,
  referralLink,
  whatsappShareUrl,
} from './referral.js';

describe('referral codes', () => {
  it('gives one guardian the same code every time', () => {
    expect(referralCodeFor('gdn_ABC123')).toBe(referralCodeFor('gdn_ABC123'));
  });

  it('gives different guardians different codes', () => {
    const codes = new Set(
      Array.from({ length: 2000 }, (_, i) => referralCodeFor(`gdn_${i}`)),
    );
    // Six characters is about a billion codes; two thousand of them should not
    // collide. If this ever fails the derivation has lost its avalanche.
    expect(codes.size).toBe(2000);
  });

  it('looks like something you can read down a phone', () => {
    const code = referralCodeFor('gdn_test');
    expect(code).toMatch(/^KPC-[0-9A-HJKMNP-TV-Z]{6}$/);
  });

  it('round-trips its own output', () => {
    const code = referralCodeFor('gdn_roundtrip');
    expect(normaliseReferralCode(code)).toBe(code);
  });

  it('forgives the ways a code is actually mistyped', () => {
    expect(normaliseReferralCode(' kpc-4g7qmx ')).toBe('KPC-4G7QMX');
    expect(normaliseReferralCode('4g7qmx')).toBe('KPC-4G7QMX');
    // O for zero, I and L for one -- Crockford's own rules, and the three
    // mistakes anyone makes copying a code off a TV screen.
    expect(normaliseReferralCode('KPC-O11ABC')).toBe('KPC-011ABC');
  });

  it('does not eat a code whose body happens to start with the prefix', () => {
    expect(normaliseReferralCode('KPC-KPCM4X')).toBe('KPC-KPCM4X');
    expect(normaliseReferralCode('KPCM4X')).toBe('KPC-KPCM4X');
  });

  it('rejects what is not a code', () => {
    expect(normaliseReferralCode('')).toBeNull();
    expect(normaliseReferralCode('hello')).toBeNull();
    expect(normaliseReferralCode('KPC-TOOLONGCODE')).toBeNull();
    // U is not in the alphabet, and normalising does not invent it.
    expect(normaliseReferralCode('KPC-UUUUUU')).toBeNull();
  });
});

describe('what a parent actually shares', () => {
  it('builds a link that survives a trailing slash', () => {
    expect(referralLink('https://kidspc.online/', 'KPC-4G7QMX')).toBe(
      'https://kidspc.online/?ref=KPC-4G7QMX',
    );
  });

  it('names the child and the offer, and nothing else', () => {
    const text = referralInviteText({
      code: 'KPC-4G7QMX',
      publicUrl: 'https://kidspc.online',
      childName: 'Meera',
      trialDays: trialDaysFor(planById('lite'), { referred: true }),
    });
    expect(text).toContain('Meera has');
    expect(text).toContain('14 days free');
    expect(text).toContain('https://kidspc.online/?ref=KPC-4G7QMX');
  });

  it('works when there is no child to name', () => {
    const text = referralInviteText({
      code: 'KPC-4G7QMX',
      publicUrl: 'https://kidspc.online',
      trialDays: 14,
    });
    expect(text).toContain('The kids have');
  });

  it('lengthens a trial and never invents one', () => {
    const lite = planById('lite');
    const pro = planById('pro');
    expect(trialDaysFor(lite)).toBe(lite.trialDays);
    expect(trialDaysFor(lite, { referred: true })).toBe(lite.trialDays + REFERRAL_BONUS_DAYS);
    // Pro streams a Linux desktop on hardware we pay for. A code must not be
    // able to hand out a free fortnight of it.
    expect(pro.trialDays).toBe(0);
    expect(trialDaysFor(pro, { referred: true })).toBe(0);
    // And that holds for any plan added later, not just these two.
    for (const plan of PLANS) {
      if (plan.trialDays === 0) expect(trialDaysFor(plan, { referred: true })).toBe(0);
    }
  });

  it('escapes the message into the share url', () => {
    const url = whatsappShareUrl('a b&c');
    expect(url).toBe('https://wa.me/?text=a%20b%26c');
  });
});
