import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AGE_BAND_SPECS,
  ageBandForBirth,
  childLoginInput,
  completeConsentInput,
  createChildInput,
  defaultAllowedAppIds,
  errors,
  loginInput,
  policyInput,
  registerGuardianInput,
  resetChildInput,
  startConsentInput,
  updateChildInput,
} from '@kidpc/shared';
import { requireGuardian } from '../app.js';
import { limit } from '../limits.js';
import { type AppContext, buildChildView, loadChildForGuardian } from '../context.js';
import { defaultPolicyFor } from '../repos.js';
import { burnPasswordTime, hashSecret, verifySecret } from '../auth/password.js';
import {
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
} from '../auth/tokens.js';
import { ConsentUnavailableError, digestProof, newConsentNonce } from '../consent/verifier.js';

const REFRESH_COOKIE = 'kidpc_rt';

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
  // Guardian authentication
  // -------------------------------------------------------------------------

  app.post('/auth/register', limit(config, 10, '1 hour'), async (req, reply) => {
    const input = registerGuardianInput.parse(req.body);

    if (await repos.guardians.byEmail(input.email)) {
      // Same shape as success would be nicer for privacy, but a parent who
      // genuinely forgot they signed up needs to be told plainly.
      throw errors.conflict(
        'email_taken',
        'Email already registered',
        'An account already exists for that email. Try signing in.',
      );
    }

    const guardian = await repos.guardians.create({
      email: input.email,
      passwordHash: await hashSecret(input.password),
      displayName: input.displayName,
      timezone: input.timezone,
    });

    const { token, hash } = newRefreshToken();
    await repos.refreshTokens.issue(guardian.id, hash, config.REFRESH_TOKEN_TTL_DAYS);
    setRefreshCookie(reply, token);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: guardian.id,
      action: 'guardian.register',
      subjectType: 'guardian',
      subjectId: guardian.id,
    });

    return reply.status(201).send({
      guardian,
      accessToken: await signAccessToken(config, { kind: 'guardian', guardianId: guardian.id }),
    });
  });

  app.post('/auth/login', limit(config, 10, '15 minutes'), async (req, reply) => {
    const input = loginInput.parse(req.body);
    const row = await repos.guardians.byEmail(input.email);

    if (!row) {
      // Spend the same time we would on a real account so response latency
      // cannot be used to enumerate registered emails.
      await burnPasswordTime();
      throw errors.unauthorized('No such guardian');
    }
    if (!(await verifySecret(input.password, row.passwordHash))) {
      await repos.audit.record({
        actorType: 'guardian',
        actorId: row.id,
        action: 'guardian.login_failed',
        subjectType: 'guardian',
        subjectId: row.id,
      });
      throw errors.unauthorized('Bad password');
    }

    await repos.guardians.markLogin(row.id);
    const { token, hash } = newRefreshToken();
    await repos.refreshTokens.issue(row.id, hash, config.REFRESH_TOKEN_TTL_DAYS);
    setRefreshCookie(reply, token);
    await repos.audit.record({
      actorType: 'guardian',
      actorId: row.id,
      action: 'guardian.login',
      subjectType: 'guardian',
      subjectId: row.id,
    });

    return {
      guardian: {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        timezone: row.timezone,
        createdAt: row.createdAt,
      },
      accessToken: await signAccessToken(config, { kind: 'guardian', guardianId: row.id }),
    };
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
        birthYear: 'KidPC is designed for children aged 5 and up.',
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
      note: 'This is everything KidPC holds about your household. We do not build behavioural profiles of children.',
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
