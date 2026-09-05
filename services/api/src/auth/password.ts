import { randomBytes, type ScryptOptions, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

// promisify() resolves to the 3-argument overload and drops the options
// parameter, so the cost factors below would be silently ignored.
function scrypt(
  secret: string,
  salt: Buffer,
  keyLen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(secret, salt, keyLen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/**
 * Password and PIN hashing.
 *
 * scrypt from the standard library rather than argon2 from npm: it is memory-
 * hard, it is audited, and it does not drag a native build into a project that
 * has to be installable on a contributor's laptop in one command. The
 * parameters are recorded in the hash itself so they can be raised later
 * without invalidating anyone's password.
 */
const DEFAULTS = { N: 16384, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(DEFAULTS.saltLen);
  const key = await scrypt(secret.normalize('NFKC'), salt, DEFAULTS.keyLen, {
    N: DEFAULTS.N,
    r: DEFAULTS.r,
    p: DEFAULTS.p,
    // scrypt needs roughly 128 * N * r bytes; Node's default cap is below that.
    maxmem: 256 * DEFAULTS.N * DEFAULTS.r,
  });
  return [
    'scrypt',
    DEFAULTS.N,
    DEFAULTS.r,
    DEFAULTS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(keyB64!, 'base64');
  const actual = await scrypt(secret.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Constant-ish work for a login that will fail anyway.
 *
 * Without this, "no such account" returns in a microsecond while a real account
 * takes ~60ms, which hands an attacker a free account-enumeration oracle.
 */
export async function burnPasswordTime(): Promise<void> {
  await hashSecret('not-a-real-password');
}
