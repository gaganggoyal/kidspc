import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AGE_BAND_SPECS,
  ageBandForBirth,
  childLoginInput,
  completeConsentInput,
  createChildInput,
  defaultAllowedAppIds,
  EMAIL_CODE_TTL_MINUTES,
  emailCodeRequestInput,
  type EmailVerifyInput,
  emailVerifyInput,
  errors,
  forgotPasswordInput,
  ID_PREFIX,
  loginInput,
  newId,
  PASSWORD_RESET_TTL_MINUTES,
  PRODUCT_NAME,
  policyInput,
  registerGuardianInput,
  resetPasswordInput,
  resetChildInput,
  setPasswordInput,
  startConsentInput,
  updateChildInput,
} from '@kidpc/shared';
import { requireGuardian } from '../app.js';
import {
  passwordChangedEmail,
  passwordResetEmail,
  signInCodeEmail,
  verifyEmail,
  welcomeEmail,
} from '../email/templates.js';
import type { EmailChallengePurpose } from '../db/schema.js';
import { limit } from '../limits.js';
import { type AppContext, buildChildView, loadChildForGuardian } from '../context.js';
import { defaultPolicyFor } from '../repos.js';
import {
  NO_PASSWORD,
  burnPasswordTime,
  hasPassword,
  hashSecret,
  verifySecret,
} from '../auth/password.js';
import {
  emailCodeMatches,
  hashEmailCode,
  hashRefreshToken,
  newEmailCode,
  newRefreshToken,
  signAccessToken,
} from '../auth/tokens.js';
import { ConsentUnavailableError, digestProof, newConsentNonce } from '../consent/verifier.js';

const REFRESH_COOKIE = 'kidpc_rt';

/**
 * Letters of one kind an address can be sent in an hour. Enough for a slow
 * inbox and an impatient person pressing "send again"; not enough to use this
 * service to fill somebody's mailbox.
 */
const LETTERS_PER_HOUR = 6;

export async function registerParentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { repos, config } = ctx;

  const setRefreshCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      // Scoped to the auth routes so it is never sent with ordinary API calls.
      path: '/v1/auth',
      maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400,
    });
  };

  // -------------------------------------------------------------------------
  // Letters that carry a code
  // -------------------------------------------------------------------------

  /**
   * Nowhere to send mail, in production. Every route that exists to send a
   * code checks this first and says so, rather than accepting a request whose
   * letter can never arrive -- a sign-up that waits for ever on a code is worse
   * than a sign-up that is honestly paused.
   */
  const refuseWithoutMail = () => {
    if (config.isProduction && ctx.mailer.name === 'log') throw errors.mailUnavailable();
  };

  /**
   * Development without a mail provider: hand the code back in the response,
   * so a sign-up can be finished from the screen. Never in production, and
   * never when mail is really going out.
   */
  const devCode = (code: string | null) =>
    !config.isProduction && ctx.mailer.name === 'log' && code ? { devCode: code } : {};

  /**
   * Issue one letter of a kind to a household and queue it.
   *
   * Capped per address as well as per IP: the IP limit stops one machine
   * asking for many addresses, and this stops many machines filling one inbox.
   * Over the cap nothing is sent and the caller answers exactly as if it had
   * been, because the cap is not something a stranger should be able to probe.
   */
  const sendLetter = async (
    guardian: { id: string; email: string; displayName: string },
    purpose: EmailChallengePurpose,
  ): Promise<string | null> => {
    const now = ctx.now();
    const recent = await repos.emailChallenges.sentSince(
      guardian.id,
      purpose,
      new Date(now.getTime() - 60 * 60_000),
    );
    if (recent >= LETTERS_PER_HOUR) return null;

    const id = newId(ID_PREFIX.token);
    const { token, hash } = newRefreshToken();
    const code = newEmailCode();
    const ttlMinutes =
      purpose === 'password_reset' ? PASSWORD_RESET_TTL_MINUTES : EMAIL_CODE_TTL_MINUTES;
    await repos.emailChallenges.issue({
      id,
      guardianId: guardian.id,
      purpose,
      tokenHash: hash,
      codeHash: hashEmailCode(config, id, code),
      ttlMinutes,
      now,
    });

    // Built from configuration, never from the request. A link assembled out
    // of a Host header is how an emailed button turns into account takeover.
    const link = (path: string) => `${config.PUBLIC_URL}${path}?token=${encodeURIComponent(token)}`;
    const common = {
      to: guardian.email,
      displayName: guardian.displayName,
      code,
      publicUrl: config.PUBLIC_URL,
    };
    await ctx.outbox.enqueue(
      purpose === 'verify_email'
        ? verifyEmail({ ...common, url: link('/verify') })
        : purpose === 'sign_in'
          ? signInCodeEmail({ ...common, url: link('/verify') })
          : passwordResetEmail({ ...common, url: link('/reset'), ttlMinutes }),
    );
    return code;
  };

  /**
   * Find the letter a code or a button belongs to, or null.
   *
   * A wrong code counts against every live letter it could have been meant
   * for, and a letter that reaches the limit is spent -- so six digits cannot be
   * walked through a few at a time. An unknown address costs the same as a
   * wrong code and answers the same, so this is not a way to ask which
   * addresses have accounts.
   */
  const redeem = async (input: EmailVerifyInput, purposes: readonly EmailChallengePurpose[]) => {
    const now = ctx.now();
    if ('token' in input) {
      const row = await repos.emailChallenges.byToken(hashRefreshToken(input.token), purposes, now);
      const guardian = row ? await repos.guardians.byId(row.guardianId) : null;
      return row && guardian ? { challenge: row, guardian } : null;
    }
    const guardian = await repos.guardians.byEmail(input.email);
    if (!guardian) return null;
    const live = await repos.emailChallenges.liveFor(guardian.id, purposes, now);
    const match = live.find(
      (row) => row.codeHash && emailCodeMatches(config, row.id, input.code, row.codeHash),
    );
    if (!match) {
      await repos.emailChallenges.recordMiss(
        live.map((row) => row.id),
        now,
      );
      return null;
    }
    return { challenge: match, guardian };
  };

  /** A refresh cookie and an access token: what "signed in" is made of. */
  const signIn = async (
    reply: FastifyReply,
    guardian: { id: string; email: string; displayName: string; timezone: string; createdAt: Date },
  ) => {
    const { token, hash } = newRefreshToken();
    await repos.refreshTokens.issue(guardian.id, hash, config.REFRESH_TOKEN_TTL_DAYS);
    setRefreshCookie(reply, token);
    await repos.guardians.markLogin(guardian.id);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardian.id,
      action: 'guardian.login',
      subjectType: 'guardian',
      subjectId: guardian.id,
    });
    return {
      guardian: {
        id: guardian.id,
        email: guardian.email,
        displayName: guardian.displayName,
        timezone: guardian.timezone,
        createdAt: guardian.createdAt,
      },
      accessToken: await signAccessToken(config, { kind: 'guardian', guardianId: guardian.id }),
    };
  };

  /**
   * The address has been proved. The first time, that is also the moment the
   * account starts: audited, and welcomed -- the welcome waits for this so that
   * nothing but a code is ever sent to an address nobody has confirmed.
   */
  const confirmAddress = async (guardian: { id: string; email: string; displayName: string }) => {
    if (!(await repos.guardians.markEmailVerified(guardian.id, ctx.now()))) return;
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardian.id,
      action: 'guardian.email_verified',
      subjectType: 'guardian',
      subjectId: guardian.id,
    });
    await ctx.outbox.enqueue(
      welcomeEmail({
        to: guardian.email,
        displayName: guardian.displayName,
        publicUrl: config.PUBLIC_URL,
      }),
    );
  };

  // -------------------------------------------------------------------------
  // Guardian authentication
  // -------------------------------------------------------------------------

  /**
   * Sign up: a name and an address. The answer is a letter, not a session.
   *
   * An address that already belongs to a confirmed account is told so plainly
   * -- a parent who forgot they signed up needs to hear it. One that was typed
   * before and never confirmed is simply sent a fresh code: whoever can read
   * that inbox is the owner, and the name is theirs to set. There is no
   * password to take over, because none is chosen until the address is proved.
   */
  app.post('/auth/register', limit(config, 10, '1 hour'), async (req, reply) => {
    const input = registerGuardianInput.parse(req.body);
    refuseWithoutMail();

    const existing = await repos.guardians.byEmail(input.email);
    if (existing?.emailVerifiedAt) {
      throw errors.conflict(
        'email_taken',
        'Email already registered',
        'An account already exists for that email. Try signing in.',
      );
    }

    let guardian: { id: string; email: string; displayName: string };
    if (existing) {
      await repos.guardians.replaceUnverified(existing.id, {
        passwordHash: NO_PASSWORD,
        displayName: input.displayName,
        timezone: input.timezone,
      });
      guardian = { ...existing, displayName: input.displayName };
    } else {
      guardian = await repos.guardians.create({
        email: input.email,
        passwordHash: NO_PASSWORD,
        displayName: input.displayName,
        timezone: input.timezone,
      });
      await repos.audit.record({
        actorType: 'guardian',
        actorId: guardian.id,
        action: 'guardian.register',
        subjectType: 'guardian',
        subjectId: guardian.id,
      });
    }

    // Queued, not sent: registration must not fail because a mail server is
    // slow, and must not succeed-but-silently-drop because one is misconfigured.
    const code = await sendLetter(guardian, 'verify_email');
    return reply
      .status(202)
      .send({ email: guardian.email, ttlMinutes: EMAIL_CODE_TTL_MINUTES, ...devCode(code) });
  });

  /**
   * Prove the address with the letter's code or button, and be signed in.
   *
   * One route for the sign-up letter and the sign-in letter, because they
   * prove the same thing: this person can read that inbox. A sign-in code on an
   * address that was never confirmed confirms it, for the same reason.
   * `needsPassword` tells the client to offer the password step next.
   */
  app.post('/auth/email/verify', limit(config, 20, '15 minutes'), async (req, reply) => {
    const input = emailVerifyInput.parse(req.body);
    const found = await redeem(input, ['verify_email', 'sign_in']);
    if (!found) throw errors.codeRejected();

    const { challenge, guardian } = found;
    await repos.emailChallenges.consume(challenge.id, ctx.now());
    const firstTime = !guardian.emailVerifiedAt;
    await confirmAddress(guardian);

    return {
      ...(await signIn(reply, guardian)),
      firstTime,
      needsPassword: !hasPassword(guardian.passwordHash),
    };
  });

  /**
   * "Email me a code": sign in without the password, or resend a sign-up code.
   *
   * Answers the same way whether or not the address is registered, for the
   * reason the forgotten-password route below does: anyone on the internet can
   * post any address here.
   */
  app.post('/auth/email/code', limit(config, 5, '15 minutes'), async (req, reply) => {
    const input = emailCodeRequestInput.parse(req.body);
    refuseWithoutMail();
    const row = await repos.guardians.byEmail(input.email);
    if (!row) {
      await burnPasswordTime();
    } else {
      await sendLetter(row, row.emailVerifiedAt ? 'sign_in' : 'verify_email');
      await repos.audit.record({
        actorType: 'guardian',
        actorId: row.id,
        action: 'guardian.sign_in_code_requested',
        subjectType: 'guardian',
        subjectId: row.id,
      });
    }
    return reply.status(202).send({ ok: true, ttlMinutes: EMAIL_CODE_TTL_MINUTES });
  });

  /**
   * The first password, chosen once the address is proved.
   *
   * Only for an account that has none. Changing a password that exists goes
   * through the emailed reset below, which signs every other device out -- a
   * change made here, with nothing but an access token, would be the one way
   * to take an account over without its inbox.
   */
  app.post('/auth/password/set', limit(config, 10, '15 minutes'), async (req) => {
    const guardianId = requireGuardian(req);
    const input = setPasswordInput.parse(req.body);
    const row = await repos.guardians.byId(guardianId);
    if (!row) throw errors.unauthorized('No such guardian');
    if (hasPassword(row.passwordHash)) {
      throw errors.conflict(
        'password_exists',
        'Password already set',
        'This account already has a password. To change it, use "Forgot your password?" on the sign-in page.',
      );
    }
    await repos.guardians.setPassword(row.id, await hashSecret(input.password));
    return { ok: true };
  });

  app.post('/auth/login', limit(config, 10, '15 minutes'), async (req, reply) => {
    const input = loginInput.parse(req.body);
    const row = await repos.guardians.byEmail(input.email);

    if (!row || !hasPassword(row.passwordHash)) {
      // Spend the same time we would on a real account so response latency
      // cannot be used to enumerate registered emails -- or to find the ones
      // that have not chosen a password yet.
      await burnPasswordTime();
      throw errors.unauthorized(
        row ? 'No password set' : 'No such guardian',
        'That email and password do not match. You can ask for a sign-in code instead.',
      );
    }
    if (!(await verifySecret(input.password, row.passwordHash))) {
      await repos.audit.record({
        actorType: 'guardian',
        actorId: row.id,
        action: 'guardian.login_failed',
        subjectType: 'guardian',
        subjectId: row.id,
      });
      throw errors.unauthorized(
        'Bad password',
        'That email and password do not match. You can ask for a sign-in code instead.',
      );
    }

    return signIn(reply, row);
  });

  app.post('/auth/refresh', async (req, reply) => {
    const presented = req.cookies[REFRESH_COOKIE];
    if (!presented) throw errors.unauthorized('No refresh cookie');

    const row = await repos.refreshTokens.findValid(hashRefreshToken(presented));
    if (!row) throw errors.unauthorized('Refresh token not recognised');

    // Rotate on every use: a stolen token is good for one call at most, and the
    // legitimate device's next refresh fails loudly instead of silently sharing.
    await repos.refreshTokens.revoke(row.id);
    const { token, hash } = newRefreshToken();
    await repos.refreshTokens.issue(row.guardianId, hash, config.REFRESH_TOKEN_TTL_DAYS);
    setRefreshCookie(reply, token);

    return {
      accessToken: await signAccessToken(config, { kind: 'guardian', guardianId: row.guardianId }),
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const presented = req.cookies[REFRESH_COOKIE];
    if (presented) {
      const row = await repos.refreshTokens.findValid(hashRefreshToken(presented));
      if (row) await repos.refreshTokens.revoke(row.id);
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Forgotten passwords
  // -------------------------------------------------------------------------

  /**
   * Ask for a reset letter: a code, and a button.
   *
   * Answers the same way whether or not the address is registered, which is
   * the opposite of what `/auth/register` does above -- and the difference is
   * deliberate rather than an inconsistency.
   *
   * Registration is a thing the person in front of us is doing on purpose, and
   * telling them "you already have an account" is the answer to the question
   * they asked. This is a form anybody on the internet can post any address
   * to, and answering it honestly turns it into a tool for finding out which
   * parents at a school use this product. So: same body, same status, and the
   * same time spent, whichever it is.
   */
  app.post('/auth/password/forgot', limit(config, 5, '1 hour'), async (req, reply) => {
    const input = forgotPasswordInput.parse(req.body);
    refuseWithoutMail();
    const row = await repos.guardians.byEmail(input.email);

    if (!row) {
      // The cost of a hash, so the two branches take comparable time. Without
      // this the response latency answers the question the body refuses to.
      await burnPasswordTime();
    } else {
      await sendLetter(row, 'password_reset');
      await repos.audit.record({
        actorType: 'guardian',
        actorId: row.id,
        action: 'guardian.password_reset_requested',
        subjectType: 'guardian',
        subjectId: row.id,
      });
    }

    // 202: we have accepted the request, and whether a message follows is
    // deliberately not stated.
    return reply.status(202).send({ ok: true, ttlMinutes: PASSWORD_RESET_TTL_MINUTES });
  });

  /**
   * Spend a reset letter -- its code or its button -- and choose a new password.
   *
   * Three things happen together, and all three matter:
   *
   *   1. the letter is consumed, so the code and the link in the mailbox are
   *      dead whether or not they are forwarded, scanned or opened twice;
   *   2. every refresh token for the household is revoked, so a device that
   *      somebody else had signed in is signed out by the reset rather than in
   *      spite of it -- this is the step that makes a reset a recovery;
   *   3. a message goes to the address on the account saying it happened.
   *
   * It also confirms the address, which it has just proved. Then we sign them
   * in, because the alternative is a screen that says "password changed, now
   * sign in" to somebody who has just proved they own the account.
   */
  app.post('/auth/password/reset', limit(config, 10, '1 hour'), async (req, reply) => {
    const input = resetPasswordInput.parse(req.body);
    const now = ctx.now();

    const found = await redeem(input, ['password_reset']);
    if (!found) {
      if ('token' in input) {
        throw errors.unauthorized(
          'Reset token not recognised',
          'That link has expired or has already been used. Ask for a new one.',
        );
      }
      throw errors.codeRejected();
    }
    const { challenge, guardian } = found;

    await repos.guardians.setPassword(guardian.id, await hashSecret(input.password));
    /*
     * Spend this one letter, and only this one.
     *
     * A sweep of every letter here as well reads like belt and braces and is
     * not: at most one unspent reset can exist, because issuing a request
     * revokes the household's earlier ones. What a second call actually did was
     * make the first untestable -- deleting `consume` left every test passing,
     * because the sweep was doing its job for it. Redundancy that hides a
     * missing step is worse than no redundancy.
     */
    await repos.emailChallenges.consume(challenge.id, now);
    await repos.refreshTokens.revokeAllFor(guardian.id);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardian.id,
      action: 'guardian.password_reset',
      subjectType: 'guardian',
      subjectId: guardian.id,
    });
    await confirmAddress(guardian);

    // A first password chosen through the reset route is not a change, and
    // "your password was changed" would alarm somebody who had never had one.
    if (hasPassword(guardian.passwordHash)) {
      await ctx.outbox.enqueue(
        passwordChangedEmail({
          to: guardian.email,
          displayName: guardian.displayName,
          publicUrl: config.PUBLIC_URL,
        }),
      );
    }

    // Issued after the revoke above, so the device doing the reset is the one
    // session that survives it.
    return signIn(reply, guardian);
  });

  /**
   * Mint a child token. Requires a signed-in guardian on the same device: a
   * four-digit PIN is a "which of my children is this" control, not an
   * authentication boundary, and must never be the only thing between the
   * internet and a child's session.
   */
  app.post('/auth/child/login', limit(config, 20, '5 minutes'), async (req) => {
    const guardianId = requireGuardian(req);
    const input = childLoginInput.parse(req.body);
    const row = await repos.children.byId(input.childId);
    if (!row || row.guardianId !== guardianId) throw errors.notFound('Child');
    if (row.archivedAt) throw errors.forbidden('Child profile is archived');

    if (!(await verifySecret(input.pin, row.pinHash))) {
      await repos.audit.record({
        actorType: 'child',
        actorId: row.id,
        action: 'child.login_failed',
        subjectType: 'child',
        subjectId: row.id,
      });
      throw errors.unauthorized('Bad PIN');
    }

    const consent = await repos.consents.activeFor(row.id);
    if (!consent) throw errors.consentRequired();

    await repos.audit.record({
      actorType: 'child',
      actorId: row.id,
      action: 'child.login',
      subjectType: 'child',
      subjectId: row.id,
    });
    return {
      accessToken: await signAccessToken(config, {
        kind: 'child',
        childId: row.id,
        guardianId,
      }),
    };
  });

  // -------------------------------------------------------------------------
  // Household
  // -------------------------------------------------------------------------

  app.get('/me', async (req) => {
    const guardianId = requireGuardian(req);
    const guardian = await repos.guardians.byId(guardianId);
    if (!guardian) throw errors.unauthorized('Guardian no longer exists');

    const rows = await repos.children.listFor(guardianId);
    const ids = rows.map((r) => r.id);
    const consented = await repos.consents.activeForChildren(ids);

    // Loaded per child rather than in one batch because each read is
    // band-aware and may upgrade the row. A household has a handful of
    // children, so the extra round-trips are not worth avoiding.
    const policies = new Map(
      await Promise.all(
        rows.map(
          async (row) =>
            [
              row.id,
              (await repos.policies.forChildInBand(
                row.id,
                ageBandForBirth(
                  { birthYear: row.birthYear, birthMonth: row.birthMonth },
                  ctx.now(),
                ) ?? 'explorer',
              ))!,
            ] as const,
        ),
      ),
    );

    const kids = await Promise.all(
      rows.map((row) =>
        buildChildView(
          ctx,
          {
            id: row.id,
            guardianId: row.guardianId,
            displayName: row.displayName,
            birthYear: row.birthYear,
            birthMonth: row.birthMonth,
            avatarId: row.avatarId,
            createdAt: row.createdAt,
            archivedAt: row.archivedAt,
          },
          policies.get(row.id)!,
          consented.has(row.id),
          guardian.timezone,
        ),
      ),
    );

    return {
      guardian: {
        id: guardian.id,
        email: guardian.email,
        displayName: guardian.displayName,
        timezone: guardian.timezone,
        createdAt: guardian.createdAt,
      },
      children: kids,
      bands: AGE_BAND_SPECS,
    };
  });

  app.post('/children', async (req, reply) => {
    const guardianId = requireGuardian(req);
    const input = createChildInput.parse(req.body);

    const band = ageBandForBirth(
      { birthYear: input.birthYear, birthMonth: input.birthMonth },
      ctx.now(),
    );
    if (!band) {
      throw errors.validation('Child is below the supported age', {
        birthYear: `${PRODUCT_NAME} is designed for children aged 5 and up.`,
      });
    }

    const child = await repos.children.create({
      guardianId,
      displayName: input.displayName,
      birthYear: input.birthYear,
      birthMonth: input.birthMonth,
      avatarId: input.avatarId,
      pinHash: await hashSecret(input.pin),
      band,
    });

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'child.create',
      subjectType: 'child',
      subjectId: child.id,
      // Band, not birth date: the audit log is not a second copy of the profile.
      meta: { band },
    });

    const policy = await repos.policies.forChild(child.id);
    const guardian = await repos.guardians.byId(guardianId);
    return reply
      .status(201)
      .send(await buildChildView(ctx, child, policy!, false, guardian!.timezone));
  });

  app.patch('/children/:id', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);
    const input = updateChildInput.parse(req.body);

    await repos.children.update(child.id, input);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'child.update',
      subjectType: 'child',
      subjectId: child.id,
      meta: { fields: Object.keys(input) },
    });
    return { ok: true };
  });

  app.post('/children/:id/archive', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);

    // End any live session first: archiving must take effect on the TV now,
    // not whenever the current session happens to run out.
    const live = await repos.sessions.liveForChild(child.id);
    if (live) await ctx.manager.endById(live.id, 'parent_ended');

    await repos.children.archive(child.id);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'child.archive',
      subjectType: 'child',
      subjectId: child.id,
    });
    return { ok: true };
  });

  /**
   * Put one thing back the way it was.
   *
   * Children break things -- a PIN they cannot remember, limits an older
   * sibling talked a parent into, a game they want to start again. Each of
   * these is recoverable on its own, so a parent never has to reach for a
   * bigger hammer than the problem needs. Every reset is audited, because a
   * reset is a change to a child's record.
   */
  app.post('/children/:id/reset', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child, band } = await loadChildForGuardian(ctx, guardianId, id);
    const input = resetChildInput.parse(req.body);

    switch (input.scope) {
      case 'limits': {
        // Back to the conservative defaults for the child's *current* age, not
        // the age they were when the profile was made.
        const defaults = defaultPolicyFor(band ?? 'explorer');
        await repos.policies.update(child.id, defaults);
        break;
      }
      case 'pin': {
        await repos.children.update(child.id, { pinHash: await hashSecret(input.pin!) });
        break;
      }
      case 'progress': {
        await repos.progress.clearFor(child.id);
        break;
      }
      case 'session': {
        const live = await repos.sessions.liveForChild(child.id);
        if (live) await ctx.manager.endById(live.id, 'parent_ended');
        break;
      }
    }

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'child.update',
      subjectType: 'child',
      subjectId: child.id,
      meta: { reset: input.scope },
    });
    return { ok: true, scope: input.scope };
  });

  // -------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------

  app.put('/children/:id/policy', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child, band } = await loadChildForGuardian(ctx, guardianId, id);
    const input = policyInput.parse(req.body);

    // A parent may switch apps off, never on above the band. Silently dropping
    // is friendlier than rejecting: the dashboard simply never offers these.
    const permitted = new Set(defaultAllowedAppIds(band ?? 'explorer'));
    const allowedAppIds = input.allowedAppIds.filter((appId) => permitted.has(appId));

    await repos.policies.update(child.id, {
      ...input,
      allowedAppIds,
      // The parent has just reviewed the list for the band the child is in now,
      // so this becomes the baseline future birthdays are measured against.
      grantedForBand: band ?? 'explorer',
    });
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'policy.update',
      subjectType: 'child',
      subjectId: child.id,
      meta: { dailyMinutes: input.dailyMinutes, apps: allowedAppIds.length },
    });

    return (await repos.policies.forChild(child.id))!;
  });

  app.get('/children/:id/usage', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);
    const guardian = await repos.guardians.byId(guardianId);

    const [history, recent] = await Promise.all([
      repos.usage.history(child.id, ctx.now(), guardian!.timezone),
      repos.sessions.recentFor(child.id, 10),
    ]);

    return {
      history,
      progress: await repos.progress.forChild(child.id),
      sessions: recent.map((s) => ({
        id: s.id,
        startedAt: s.readyAt ?? s.createdAt,
        endedAt: s.endedAt,
        minutes: s.billedMinutes,
        endReason: s.endReason,
        app: s.autoLaunchAppId,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  app.post('/children/:id/consent/start', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);
    const input = startConsentInput.parse({ ...(req.body as object), childId: child.id });

    // A deployment with no verifier refuses here, before a challenge row
    // exists, and says why. Without this the method check below reports the
    // state as "unsupported method: unavailable", which reads like a client
    // bug. 409 rather than 503 deliberately: this is a settled configuration,
    // not an outage, and it should not page anyone at three in the morning.
    if (ctx.consent.method === 'unavailable') {
      throw errors.conflict(
        'consent_unavailable',
        'No parental-consent verifier is configured',
        'We cannot set up a child account yet — parental consent checks are not available on this service. Your own account is unaffected.',
      );
    }

    if (input.method !== ctx.consent.method) {
      throw errors.validation('Unsupported consent method', {
        method: `This deployment verifies consent via "${ctx.consent.method}".`,
      });
    }

    const nonce = newConsentNonce();
    const challengeId = await repos.consents.createChallenge({
      guardianId,
      childId: child.id,
      method: input.method,
      scopes: input.scopes,
      nonce,
      ttlMinutes: 20,
    });

    const begun = await ctx.consent.begin({
      challengeId,
      nonce,
      childDisplayName: child.displayName,
    });

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'consent.challenge',
      subjectType: 'child',
      subjectId: child.id,
      meta: { method: input.method, scopes: input.scopes },
    });

    return {
      challengeId,
      method: ctx.consent.method,
      instructions: begun.instructions,
      redirectUrl: begun.redirectUrl ?? null,
      // Only ever populated by the development verifier.
      devHint: config.isProduction ? null : (begun.devHint ?? null),
    };
  });

  app.post('/children/:id/consent/complete', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);
    const input = completeConsentInput.parse(req.body);

    const challenge = await repos.consents.takeChallenge(input.challengeId);
    if (!challenge || challenge.childId !== child.id || challenge.guardianId !== guardianId) {
      throw errors.validation('Consent challenge is unknown, expired, or already used', {
        challengeId: 'Start the approval again.',
      });
    }

    let result;
    try {
      result = await ctx.consent.verify({
        challengeId: challenge.id,
        nonce: challenge.nonce,
        proof: input.proof,
      });
    } catch (cause) {
      if (cause instanceof ConsentUnavailableError) {
        // "We could not check" must not read as "approved".
        throw errors.internal(`Consent verification unavailable: ${cause.message}`, cause);
      }
      throw cause;
    }

    if (!result.ok) throw errors.forbidden('Consent proof rejected');

    await repos.consents.grant({
      guardianId,
      childId: child.id,
      method: challenge.method,
      scopes: challenge.scopes,
      proofDigest: digestProof(config, input.proof),
      expiresInDays: result.expiresInDays,
    });
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'consent.grant',
      subjectType: 'child',
      subjectId: child.id,
      meta: { method: challenge.method, evidence: result.evidence, scopes: challenge.scopes },
    });

    return { ok: true, scopes: challenge.scopes };
  });

  app.post('/children/:id/consent/revoke', async (req) => {
    const guardianId = requireGuardian(req);
    const { id } = req.params as { id: string };
    const { child } = await loadChildForGuardian(ctx, guardianId, id);

    await repos.consents.revokeFor(child.id);
    const live = await repos.sessions.liveForChild(child.id);
    if (live) await ctx.manager.endById(live.id, 'parent_ended');

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'consent.revoke',
      subjectType: 'child',
      subjectId: child.id,
    });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Data rights (DPDP ss.11-13)
  // -------------------------------------------------------------------------

  app.get('/privacy/export', async (req) => {
    const guardianId = requireGuardian(req);
    const guardian = await repos.guardians.byId(guardianId);
    if (!guardian) throw errors.unauthorized('Guardian no longer exists');

    const rows = await repos.children.listFor(guardianId);
    const kids = await Promise.all(
      rows.map(async (row) => ({
        profile: {
          displayName: row.displayName,
          birthYear: row.birthYear,
          birthMonth: row.birthMonth,
          createdAt: row.createdAt,
        },
        policy: await repos.policies.forChild(row.id),
        usage: await repos.usage.history(row.id, ctx.now(), guardian.timezone, 365),
        progress: await repos.progress.forChild(row.id),
        consentHistory: await repos.audit.forSubject('child', row.id),
      })),
    );

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'data.export',
      subjectType: 'guardian',
      subjectId: guardianId,
    });

    return {
      exportedAt: ctx.now().toISOString(),
      guardian: {
        email: guardian.email,
        displayName: guardian.displayName,
        timezone: guardian.timezone,
        createdAt: guardian.createdAt,
      },
      children: kids,
      note: `This is everything ${PRODUCT_NAME} holds about your household. We do not build behavioural profiles of children.`,
    };
  });

  app.post('/privacy/erase', async (req) => {
    const guardianId = requireGuardian(req);

    // End every live session before the rows go away, otherwise the desktops
    // outlive the records that would have reclaimed them.
    for (const row of await repos.children.listFor(guardianId)) {
      const live = await repos.sessions.liveForChild(row.id);
      if (live) await ctx.manager.endById(live.id, 'parent_ended');
    }

    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardianId,
      action: 'data.erase',
      subjectType: 'guardian',
      subjectId: guardianId,
    });
    await repos.refreshTokens.revokeAllFor(guardianId);
    await repos.guardians.purge(guardianId);

    return { ok: true, erased: true };
  });
}
