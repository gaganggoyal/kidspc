import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ageBandForBirth, errors, originsForApps } from '@kidpc/shared';
import { visibleApps } from '@kidpc/policy';
import type { AppContext } from '../context.js';

const egressPolicyInput = z.object({
  sessionId: z.string().min(1),
  /** The desktop's own connection secret, proving it is that session. */
  secret: z.string().min(1),
});

/**
 * Control-plane routes for other KidPC components, not for users.
 *
 * MUST NOT be exposed publicly. In the compose topology these are reachable
 * only from the internal network; behind a real edge, block `/internal/*`.
 */
export async function registerInternalRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * What may this desktop reach?
   *
   * The egress proxy asks on every cache miss. A desktop authenticates with the
   * session id and the one-time secret it was booted with, so the proxy never
   * has to trust a source IP -- which matters because container addresses are
   * recycled, and the previous tenant's allow-list is exactly the wrong thing
   * to inherit.
   *
   * Answering from the child's *current* policy rather than a snapshot means a
   * parent switching off the research app closes those origins within one cache
   * TTL, without restarting the session.
   */
  app.post('/internal/egress/policy', async (req) => {
    const input = egressPolicyInput.parse(req.body);

    const session = await ctx.repos.sessions.byId(input.sessionId);
    if (!session || session.state === 'terminated' || !session.endpointSecret) {
      throw errors.forbidden('No such live session');
    }

    const presented = Buffer.from(input.secret);
    const expected = Buffer.from(session.endpointSecret);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw errors.forbidden('Bad session secret');
    }
    if (ctx.now() >= session.deadline) {
      // The reaper may not have swept yet; a session past its deadline gets
      // nothing regardless.
      throw errors.forbidden('Session lease has expired');
    }

    const [child, policy] = await Promise.all([
      ctx.repos.children.byId(session.childId),
      ctx.repos.policies.forChild(session.childId),
    ]);
    if (!child || !policy) throw errors.forbidden('Session has no child');

    const band =
      ageBandForBirth({ birthYear: child.birthYear, birthMonth: child.birthMonth }, ctx.now()) ??
      'explorer';

    return {
      sessionId: session.id,
      origins: originsForApps(visibleApps(policy, band)),
      /** Seconds the proxy may cache this answer. */
      ttlSeconds: 60,
    };
  });
}
