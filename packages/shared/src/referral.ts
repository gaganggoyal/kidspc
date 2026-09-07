/**
 * Referrals.
 *
 * The growth loop for a children's product cannot run through the children.
 * DPDP 2023 s.9 bars tracking, behavioural monitoring and targeted advertising
 * aimed at a child, and every ordinary viral mechanic -- friend graphs, public
 * profiles, child-to-child invitations, leaderboards against strangers -- is
 * either one of those or a safeguarding problem in its own right.
 *
 * So the loop runs through the parent, who is also the person holding the card.
 * A parent gets a code, shares it with another parent, and both households get
 * something. No child ever sends anything to anyone.
 *
 * The code is *derived* from the guardian id rather than stored, which means
 * issuing one needs no column, no migration and no generation step that can
 * fail halfway. The cost is that it is a lookup hint rather than a key: six
 * Crockford characters is about a billion codes, so at any plausible scale a
 * collision is unlikely but not impossible. The server therefore resolves a
 * code by scanning and reports *every* match rather than picking one -- an
 * ambiguous credit is a question for a person, not a coin toss.
 */

/** Extra free days for a household that arrives with a code. */
export const REFERRAL_BONUS_DAYS = 7;

/** What the referring household gets, once the household they sent us pays. */
export const REFERRAL_REWARD_MONTHS = 1;

/** Crockford base32: no I, L, O or U, so nothing is misheard on a phone call. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;
const PREFIX = 'KPC';

function fnv1a64(input: string): bigint {
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & mask;
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash;
}

/**
 * The code a given guardian shares. Stable for the life of the account, so a
 * code written on a WhatsApp message a year ago still resolves.
 */
export function referralCodeFor(guardianId: string): string {
  let hash = fnv1a64(`kidspc:referral:${guardianId}`);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Number(hash & 31n)]!;
    hash >>= 5n;
  }
  return `${PREFIX}-${out}`;
}

/**
 * Cleans up whatever a parent actually typed.
 *
 * Crockford's own confusion rules are applied -- O becomes zero, I and L become
 * one -- because a code that is read aloud across a room and typed on a TV
 * remote will be mistyped in exactly those ways, and refusing it is a lost sale
 * over a font choice. Returns null for anything that is not a code at all.
 */
export function normaliseReferralCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
  // Strip the prefix only when doing so leaves exactly a code. One body in
  // thirty-odd thousand legitimately begins "KPC", and an unconditional strip
  // would make that household's code the one that never works.
  const body =
    cleaned.length === PREFIX.length + CODE_LENGTH && cleaned.startsWith(PREFIX)
      ? cleaned.slice(PREFIX.length)
      : cleaned;
  if (body.length !== CODE_LENGTH) return null;
  if (![...body].every((c) => ALPHABET.includes(c))) return null;
  return `${PREFIX}-${body}`;
}

/** The link a parent actually sends. */
export function referralLink(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/?ref=${encodeURIComponent(code)}`;
}

/**
 * The message that gets forwarded.
 *
 * Written to be pasted into a family WhatsApp group by a parent who is not
 * selling anything -- so it leads with what their own child did, mentions the
 * offer once, and is short enough to read without expanding.
 */
export function referralInviteText(input: {
  code: string;
  publicUrl: string;
  childName?: string | null;
  /** The *total* free days the invited household gets, not the bonus alone. */
  trialDays: number;
}): string {
  const who = input.childName ? `${input.childName} has` : 'The kids have';
  return [
    `${who} been using Online Kids PC on our TV — drawing, typing, little coding puzzles. No ads, and I set how long they get.`,
    ``,
    `If you want to try it, this link gives you ${input.trialDays} days free instead of the usual week:`,
    referralLink(input.publicUrl, input.code),
  ].join('\n');
}

/** How long a referred household's trial runs. One place, so nothing disagrees. */
export function referredTrialDays(baseTrialDays: number): number {
  return baseTrialDays + REFERRAL_BONUS_DAYS;
}

/**
 * A WhatsApp share URL. Plain wa.me rather than an SDK: no script to load, no
 * third-party origin in the CSP, and nothing that could report back who shared
 * what -- which on a page a parent reaches from their child's screen matters.
 */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
