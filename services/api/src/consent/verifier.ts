import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ConsentMethod } from '@kidpc/shared';
import type { Config } from '../config.js';

/**
 * Verifiable parental consent.
 *
 * The DPDP Act requires that consent for a child's data comes from an adult who
 * has been *verified* -- not merely from whoever ticked a box. What counts as
 * adequate verification is a moving target and will differ by market, so the
 * mechanism sits behind this interface and the rest of the system only ever
 * learns "consent exists / does not exist".
 *
 * Two rules hold for every implementation:
 *   1. The raw proof (an ID token, a signed assertion, a payment reference) is
 *      never persisted. We keep a peppered digest, which is enough to show
 *      consent was obtained and to re-check a fresh proof against it.
 *   2. Failure is never silent. A verifier that cannot reach its provider must
 *      throw, not return `false` -- "we could not check" and "the parent is not
 *      who they say" are different answers with different consequences.
 */
export interface ConsentVerifier {
  readonly method: ConsentMethod;
  /** Everything the client needs to carry out the check. */
  begin(input: BeginInput): Promise<BeginResult>;
  /** Validate what the client brought back. */
  verify(input: VerifyInput): Promise<VerifyResult>;
}

export interface BeginInput {
  challengeId: string;
  nonce: string;
  childDisplayName: string;
}

export interface BeginResult {
  /** Where to send the parent, when the method is redirect-based. */
  redirectUrl?: string;
  /** Shown to the parent in-app. */
  instructions: string;
  /** Development only: the value that will satisfy `verify`. */
  devHint?: string;
}

export interface VerifyInput {
  challengeId: string;
  nonce: string;
  proof: string;
}

export interface VerifyResult {
  ok: boolean;
  /** How long this consent stands before it must be renewed. */
  expiresInDays: number | null;
  /** Non-identifying note for the audit log, e.g. "digilocker:aadhaar". */
  evidence: string;
}

export class ConsentUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConsentUnavailableError';
  }
}

/**
 * Development verifier.
 *
 * Prints a code and accepts it back. It exists so the consent *flow* -- the
 * challenge record, the expiry, the audit trail, the gate on session start --
 * can be exercised end to end without a DigiLocker partner agreement. Config
 * refuses to let this run in production.
 */
export class MockConsentVerifier implements ConsentVerifier {
  readonly method = 'dev_mock' as const;

  async begin(input: BeginInput): Promise<BeginResult> {
    const code = input.nonce.slice(0, 6).toUpperCase();
    return {
      instructions: `DEVELOPMENT ONLY. Enter the code ${code} to approve ${input.childDisplayName}'s account. This is not a real identity check.`,
      devHint: code,
    };
  }

  async verify(input: VerifyInput): Promise<VerifyResult> {
    const expected = Buffer.from(input.nonce.slice(0, 6).toUpperCase());
    const actual = Buffer.from(input.proof.trim().toUpperCase());
    const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
    return { ok, expiresInDays: 365, evidence: 'dev_mock' };
  }
}

/**
 * DigiLocker-backed verification.
 *
 * The intended flow: the parent is redirected to DigiLocker, authenticates with
 * Aadhaar-linked credentials, and we receive a signed assertion that an adult
 * consented for this specific challenge. We keep the digest of that assertion
 * and the fact that it was an adult -- never the document, never the Aadhaar
 * number, never a name.
 *
 * NOT WIRED UP. Completing this needs a Meripehchaan/DigiLocker partner
 * registration and the issued client credentials; the endpoints below are
 * placeholders and the class refuses to pretend otherwise. It is here so the
 * shape of the integration -- and the boundary it must not cross -- is fixed
 * before anyone builds against it.
 */
export class DigiLockerConsentVerifier implements ConsentVerifier {
  readonly method = 'digilocker' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  async begin(input: BeginInput): Promise<BeginResult> {
    const url = new URL('https://api.digitallocker.gov.in/public/oauth2/1/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    // The nonce ties the assertion to this challenge so a proof cannot be
    // replayed against a different child.
    url.searchParams.set('state', input.challengeId);
    url.searchParams.set('nonce', input.nonce);
    return {
      redirectUrl: url.toString(),
      instructions: 'Sign in with DigiLocker to confirm you are this child’s parent or guardian.',
    };
  }

  async verify(_input: VerifyInput): Promise<VerifyResult> {
    throw new ConsentUnavailableError(
      'DigiLocker verification is not implemented: it requires partner credentials and a signed-assertion contract. ' +
        'Do not enable CONSENT_VERIFIER=digilocker until the token exchange and signature validation below are written.',
    );
    // Implementation sketch, deliberately left unwritten rather than faked:
    //   1. POST /public/oauth2/1/token  { code, client_id, client_secret, redirect_uri }
    //   2. Validate the assertion signature against DigiLocker's published keys.
    //   3. Assert the `nonce` claim equals `_input.nonce` (replay protection).
    //   4. Assert the subject is >= 18 per the issuer's age attribute.
    //   5. Return only { ok, expiresInDays, evidence: 'digilocker:aadhaar' }.
  }
}

export function createConsentVerifier(config: Config): ConsentVerifier {
  switch (config.CONSENT_VERIFIER) {
    case 'digilocker':
      return new DigiLockerConsentVerifier(
        config.DIGILOCKER_CLIENT_ID ?? '',
        config.DIGILOCKER_CLIENT_SECRET ?? '',
        `${config.WEB_ORIGIN}/consent/callback`,
      );
    case 'mock':
      return new MockConsentVerifier();
  }
}

export function newConsentNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Peppered digest of a consent proof.
 *
 * The pepper lives in configuration rather than the database, so a dump of the
 * consents table on its own reveals nothing about the proofs behind it.
 */
export function digestProof(config: Config, proof: string): string {
  return createHmac('sha256', config.consentPepper).update(proof).digest('base64url');
}
