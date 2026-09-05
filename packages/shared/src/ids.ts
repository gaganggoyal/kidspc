/**
 * Identifier generation.
 *
 * Uses Web Crypto rather than `node:crypto` so this package stays isomorphic:
 * the same catalogue, policy types and helpers are imported by the API, the
 * broker and the browser client, and a single Node-only import here would drag
 * a polyfill into the web bundle. `globalThis.crypto` is standard in Node 18+,
 * every current browser, and edge runtimes.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64URL[a >> 2];
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BASE64URL[c & 63];
  }
  return out;
}

/**
 * Prefixed, lexicographically sortable identifier (ULID-shaped).
 *
 * The prefix makes IDs self-describing in logs and support tickets, and the
 * time component keeps primary-key inserts append-ordered, which matters once
 * the session table is the hottest write path in the system.
 */
export function newId(prefix: string): string {
  const time = Date.now();
  const timeBytes = new Uint8Array(6);
  for (let i = 5; i >= 0; i--) timeBytes[i] = (time / 2 ** (8 * (5 - i))) & 0xff;
  return `${prefix}_${encodeBase32(timeBytes)}${encodeBase32(randomBytes(10))}`.toLowerCase();
}

export const ID_PREFIX = {
  guardian: 'gdn',
  child: 'kid',
  consent: 'cns',
  session: 'ses',
  audit: 'aud',
  device: 'dev',
  token: 'tok',
} as const;

/** URL-safe random string for opaque tokens (refresh tokens, pairing codes). */
export function randomToken(bytes = 32): string {
  return encodeBase64Url(randomBytes(bytes));
}

/** Human-typeable pairing code for the TV app: 6 chars, no ambiguous glyphs. */
export function pairingCode(): string {
  // The alphabet is 32 long -- a divisor of 256 -- so `% length` is unbiased.
  // Changing its size would need rejection sampling to stay uniform.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
}
