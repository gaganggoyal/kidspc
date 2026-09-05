import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ID_PREFIX, errors, newId } from '@kidpc/shared';
import type { Config } from '../config.js';

export type Principal =
  | { kind: 'guardian'; guardianId: string }
  | { kind: 'child'; childId: string; guardianId: string };

const ISSUER = 'kidpc';

/**
 * Access tokens are short-lived and stateless; refresh tokens are long-lived
 * and stateful. The split is what makes "sign this child's TV out right now"
 * actually work: revoking the stored refresh token stops renewal, and the
 * access token expires within minutes on its own.
 */
export async function signAccessToken(config: Config, principal: Principal): Promise<string> {
  const claims: Record<string, unknown> =
    principal.kind === 'guardian'
      ? { typ: 'guardian' }
      : { typ: 'child', gdn: principal.guardianId };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(principal.kind)
    .setSubject(principal.kind === 'guardian' ? principal.guardianId : principal.childId)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(newId(ID_PREFIX.token))
    .sign(config.jwtSecret);
}

export async function verifyAccessToken(config: Config, token: string): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    if (payload.typ === 'guardian') {
      return { kind: 'guardian', guardianId: String(payload.sub) };
    }
    if (payload.typ === 'child' && typeof payload.gdn === 'string') {
      return { kind: 'child', childId: String(payload.sub), guardianId: payload.gdn };
    }
    throw new Error(`Unknown token type ${String(payload.typ)}`);
  } catch (cause) {
    throw errors.unauthorized(cause instanceof Error ? cause.message : 'Bad token');
  }
}

/**
 * Refresh tokens are stored as digests, never in the clear: a leaked database
 * dump should not be a set of working sessions. They are high-entropy random
 * values, so a plain SHA-256 is the right primitive here -- there is nothing
 * to brute-force and no reason to pay a KDF's cost on every renewal.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function refreshTokenMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashRefreshToken(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Stream tickets.
 *
 * A browser cannot set an Authorization header on a WebSocket handshake, so the
 * credential has to travel in the URL. That makes it the most exposed token we
 * issue -- it lands in proxy logs and browser history -- which is why it lives
 * for seconds, is bound to one session id, and grants nothing except that
 * session's pixel stream.
 */
const STREAM_TICKET_TTL_SECONDS = 30;

export async function signStreamTicket(
  config: Config,
  sessionId: string,
  childId: string,
): Promise<{ ticket: string; expiresInSeconds: number }> {
  const ticket = await new SignJWT({ typ: 'stream', kid: childId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('stream')
    .setSubject(sessionId)
    .setIssuedAt()
    .setExpirationTime(`${STREAM_TICKET_TTL_SECONDS}s`)
    .setJti(newId(ID_PREFIX.token))
    .sign(config.jwtSecret);
  return { ticket, expiresInSeconds: STREAM_TICKET_TTL_SECONDS };
}

export async function verifyStreamTicket(
  config: Config,
  ticket: string,
): Promise<{ sessionId: string; childId: string }> {
  try {
    const { payload } = await jwtVerify(ticket, config.jwtSecret, {
      issuer: ISSUER,
      audience: 'stream',
      algorithms: ['HS256'],
    });
    if (payload.typ !== 'stream' || typeof payload.kid !== 'string') {
      throw new Error('Not a stream ticket');
    }
    return { sessionId: String(payload.sub), childId: payload.kid };
  } catch (cause) {
    throw errors.unauthorized(cause instanceof Error ? cause.message : 'Bad stream ticket');
  }
}
