import type { FastifyInstance } from 'fastify';
import {
  TRIAL_DAYS,
  createOrderInput,
  monthlyPriceInr,
  newId,
  planById,
  referredTrialDays,
} from '@kidpc/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { planOrders } from '../db/schema.js';
import { limit } from '../limits.js';
import { orderInternalEmail, orderReceivedEmail } from '../email/templates.js';

/**
 * Plan requests.
 *
 * Public and unauthenticated on purpose: asking to buy something should not
 * require first creating an account, and a parent who has not decided yet will
 * not create one. The route therefore assumes nothing about the caller, is rate
 * limited hard, and creates no account and no session.
 *
 * It also takes no payment details, because there is no payment integration.
 * What it does is record the request and send two messages: a confirmation to
 * the household, and a notification to whoever will send the payment link.
 */
export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, repos } = ctx;

  app.post('/orders', limit(config, 10, '1 hour'), async (req, reply) => {
    const input = createOrderInput.parse(req.body);
    const plan = planById(input.planId);

    /*
     * Priced on the server from the plan table, never from the request.
     * The client sends how many children, not what it thinks that costs --
     * otherwise a request could quote itself any figure it liked, and the
     * confirmation email would repeat it back as though we had agreed.
     */
    const quotedInr = monthlyPriceInr(plan, input.children);

    /*
     * The referral code has already been normalised, or turned into null,
     * by the schema. It is never validated against a real guardian here: the
     * lookup is a scan, it can legitimately return nothing, and a household
     * that pasted a code slightly wrong must not be turned away at the point
     * of buying. The longer trial is honoured on the strength of the code
     * looking like one; whether anyone gets rewarded for it is decided later,
     * by a person, from `pnpm orders referrer`.
     */
    const referralCode = input.referralCode ?? null;
    const trialDays = referralCode ? referredTrialDays(TRIAL_DAYS) : TRIAL_DAYS;

    // A signed-in guardian gets their request linked to their account; a
    // stranger does not, and neither is asked to prove anything here.
    const guardianId = req.principal?.kind === 'guardian' ? req.principal.guardianId : null;

    const id = newId('ord');
    await ctx.database.db.insert(planOrders).values({
      id,
      email: input.email,
      contactName: input.contactName ?? null,
      planId: input.planId,
      children: input.children,
      quotedInr,
      guardianId,
      referralCode,
      createdAt: ctx.now(),
    });

    await ctx.outbox.enqueue(
      orderReceivedEmail({
        to: input.email,
        contactName: input.contactName,
        plan,
        children: input.children,
        quotedInr,
        publicUrl: config.PUBLIC_URL,
        trialDays,
        referred: Boolean(referralCode),
      }),
    );

    const notify = config.ORDERS_EMAIL ?? config.SMTP_USER;
    if (notify) {
      await ctx.outbox.enqueue(
        orderInternalEmail({
          to: notify,
          orderId: id,
          email: input.email,
          contactName: input.contactName,
          plan,
          children: input.children,
          quotedInr,
          guardianId,
          referralCode,
          publicUrl: config.PUBLIC_URL,
        }),
      );
    }

    await repos.audit.record({
      actorType: guardianId ? 'guardian' : 'system',
      actorId: guardianId,
      action: 'order.requested',
      subjectType: 'order',
      subjectId: id,
      meta: { planId: input.planId, children: input.children, quotedInr, referralCode },
    });

    reply.code(201);
    return {
      orderId: id,
      planId: plan.id,
      planName: plan.name,
      children: input.children,
      quotedInr,
      trialDays,
      referred: Boolean(referralCode),
      // The client shows this rather than composing its own promise, so the
      // page and the email cannot come to say different things.
      message: referralCode
        ? `Thank you — we have your request, and the code you arrived with. We will email you a payment link shortly, and your first ${trialDays} days are free rather than the usual ${TRIAL_DAYS}. No card details were asked for or stored.`
        : 'Thank you — we have your request. We will email you a payment link shortly. No card details were asked for or stored.',
    };
  });

  /** An order a guardian made, so the dashboard can show it. Never a list. */
  app.get('/orders/:id', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await ctx.database.db.select().from(planOrders).where(eq(planOrders.id, id));
    const order = rows[0];
    // Not found rather than forbidden for an order that is not yours: an id is
    // the only secret here, and confirming that one exists would leak it.
    const viewer = req.principal?.kind === 'guardian' ? req.principal.guardianId : null;
    if (!order || !viewer || order.guardianId !== viewer) {
      return { order: null };
    }
    return {
      order: {
        id: order.id,
        planId: order.planId,
        children: order.children,
        quotedInr: order.quotedInr,
        status: order.status,
        createdAt: order.createdAt,
      },
    };
  });
}
