import type { FastifyInstance } from 'fastify';
import {
  AGE_BAND_SPECS,
  ageBandForBirth,
  errors,
  startSessionInput,
} from '@kidpc/shared';
import { evaluateSessionStart, remainingToday, visibleApps } from '@kidpc/policy';
import type { StartContext } from '@kidpc/broker';
import { requireChild } from '../app.js';
import { limit } from '../limits.js';
import { signStreamTicket } from '../auth/tokens.js';
import type { AppContext } from '../context.js';

/**
 * The surface a child's device talks to. Every route here is authenticated as
 * a child, and none of them accept a child id from the request body -- the
 * identity comes from the token, so one child's TV cannot address another's
 * session even inside the same household.
 */
export async function registerKidRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { repos } = ctx;

  async function contextFor(childId: string, guardianId: string): Promise<StartContext> {
    const child = await repos.children.byId(childId);
    if (!child || child.guardianId !== guardianId) throw errors.notFound('Child');

    const band = ageBandForBirth(
      { birthYear: child.birthYear, birthMonth: child.birthMonth },
      ctx.now(),
    );
    const [policy, consent, guardian] = await Promise.all([
      // Band-aware: a child who had a birthday since their last session gets
      // the new band's apps here, without anyone having to intervene.
      repos.policies.forChildInBand(childId, band ?? 'explorer'),
      repos.consents.activeFor(childId),
      repos.guardians.byId(guardianId),
    ]);
    if (!policy) throw errors.internal(`Child ${childId} has no policy row`);

    const timezone = guardian?.timezone ?? 'Asia/Kolkata';
    const usage = await repos.usage.summary(childId, ctx.now(), timezone);

    return {
      childId,
      guardianId,
      band,
      policy,
      consentGranted: Boolean(consent),
      archived: Boolean(child.archivedAt),
      timezone,
      usage,
    };
  }

  /**
   * The launcher's entire payload in one call: which apps to draw, how much
   * time is left, and whether a session is already running. A TV app on a slow
   * connection should not need three round-trips to render its first screen.
   */
  app.get('/home', async (req) => {
    const { childId, guardianId } = requireChild(req);
    const start = await contextFor(childId, guardianId);
    const child = await repos.children.byId(childId);
    const band = start.band ?? 'explorer';

    const decision = evaluateSessionStart({
      policy: start.policy,
      band: start.band,
      consentGranted: start.consentGranted,
      archived: start.archived,
      usage: start.usage,
      now: ctx.now(),
      timezone: start.timezone,
    });

    const live = await repos.sessions.liveForChild(childId);

    return {
      child: { id: childId, displayName: child!.displayName, avatarId: child!.avatarId, band },
      bandSpec: AGE_BAND_SPECS[band],
      apps: visibleApps(start.policy, band).map((appEntry) => ({
        id: appEntry.id,
        name: appEntry.name,
        tagline: appEntry.tagline,
        category: appEntry.category,
      })),
      time: {
        dailyMinutes: start.policy.dailyMinutes,
        usedTodayMinutes: start.usage.todayMinutes,
        remainingMinutes: remainingToday(start.policy, start.usage.todayMinutes),
      },
      canStart: decision.allowed,
      // A child is always told *why* the answer is no, in their own words.
      blocked: decision.allowed
        ? null
        : {
            reason: decision.reason,
            message: decision.userMessage,
            retryAt: decision.retryAt?.toISOString() ?? null,
          },
      // Parents can enable per-session summaries; when they do, the child is
      // shown that it is on. Surveillance a child cannot see is not acceptable.
      summariesEnabled: start.policy.sessionSummaries,
      session: live ? ctx.manager.toView(live, ctx.now()) : null,
    };
  });

  app.post('/sessions', limit(ctx.config, 20, '5 minutes'), async (req, reply) => {
    const { childId, guardianId } = requireChild(req);
    const input = startSessionInput.parse(req.body ?? {});
    const start = await contextFor(childId, guardianId);

    const result = await ctx.manager.start(start, {
      appId: input.appId,
      deviceKind: input.deviceKind,
    });

    if (!result.ok) {
      await repos.audit.record({
        actorType: 'child',
        actorId: childId,
        action: 'session.denied',
        subjectType: 'child',
        subjectId: childId,
        meta: { reason: result.reason },
      });
      return reply.status(403).send({
        error: {
          code: result.reason,
          message: result.userMessage,
          details: { retryAt: result.retryAt?.toISOString() ?? null },
        },
      });
    }

    await repos.audit.record({
      actorType: 'child',
      actorId: childId,
      action: 'session.start',
      subjectType: 'session',
      subjectId: result.session.id,
      meta: { app: result.session.autoLaunchAppId, device: result.session.deviceKind },
    });
    return reply.status(201).send(result.view);
  });

  app.get('/sessions/current', async (req) => {
    const { childId } = requireChild(req);
    const live = await repos.sessions.liveForChild(childId);
    return live ? ctx.manager.toView(live, ctx.now()) : null;
  });

  /**
   * Called every ~30 seconds by an active client. Doubles as the billing tick,
   * so the session that stops being watched stops consuming a child's day.
   */
  app.post('/sessions/:id/heartbeat', limit(ctx.config, 120, '1 minute'), async (req) => {
    const { childId } = requireChild(req);
    const { id } = req.params as { id: string };
    const session = await repos.sessions.byId(id);
    if (!session || session.childId !== childId) throw errors.notFound('Session');
    return ctx.manager.heartbeat(id);
  });

  /**
   * Exchange a child token for a short-lived ticket the WebSocket handshake can
   * carry in its URL. Issued per connection attempt, never reused.
   */
  app.post('/sessions/:id/ticket', async (req) => {
    const { childId } = requireChild(req);
    const { id } = req.params as { id: string };
    const session = await repos.sessions.byId(id);
    if (!session || session.childId !== childId) throw errors.notFound('Session');
    if (session.state === 'terminated') throw errors.forbidden('Session has ended');

    const { ticket, expiresInSeconds } = await signStreamTicket(ctx.config, id, childId);
    return { ticket, expiresInSeconds, path: `/stream/${id}` };
  });

  app.post('/sessions/:id/end', async (req) => {
    const { childId } = requireChild(req);
    const { id } = req.params as { id: string };
    const session = await repos.sessions.byId(id);
    if (!session || session.childId !== childId) throw errors.notFound('Session');

    await ctx.manager.endById(id, 'child_ended');
    await repos.audit.record({
      actorType: 'child',
      actorId: childId,
      action: 'session.end',
      subjectType: 'session',
      subjectId: id,
      meta: { reason: 'child_ended' },
    });
    return { ok: true };
  });
}
