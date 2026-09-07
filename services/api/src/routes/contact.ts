import type { FastifyInstance } from 'fastify';
import { contactMessageInput } from '@kidpc/shared';
import type { AppContext } from '../context.js';
import { limit } from '../limits.js';
import { contactAckEmail, contactMessageEmail } from '../email/templates.js';

/**
 * The contact form.
 *
 * Public and unauthenticated, like the order route and for the same reason: a
 * parent with a question has not signed up yet, and requiring them to is how
 * the question goes unasked.
 *
 * A form rather than a `mailto:` link. Half the people who would write have no
 * mail client configured on the device they are reading this on -- a TV
 * browser has none at all -- and a link that opens nothing looks like a service
 * that does not want to be contacted. It is also the contact method a payment
 * provider's merchant review expects to find working.
 *
 * Rate limited hard, and it stores nothing: the message goes into the outbox
 * and nowhere else. There is no support-ticket table, because a table that
 * accumulates unread messages from strangers is a liability with no owner.
 */
export function registerContactRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;

  app.post('/contact', limit(config, 5, '1 hour'), async (req, reply) => {
    const input = contactMessageInput.parse(req.body);

    const desk = config.ORDERS_EMAIL ?? config.SMTP_USER;
    if (desk) {
      await ctx.outbox.enqueue(
        contactMessageEmail({
          to: desk,
          from: input.email,
          name: input.name,
          message: input.message,
          publicUrl: config.PUBLIC_URL,
        }),
      );
    }

    /*
     * The acknowledgement is queued even where there is no desk to deliver the
     * message to, because the person who wrote is owed an answer either way and
     * the outbox is durable: a deployment whose mailbox is configured later
     * sends both of these on its first sweep rather than losing them.
     */
    await ctx.outbox.enqueue(
      contactAckEmail({
        to: input.email,
        name: input.name,
        message: input.message,
        publicUrl: config.PUBLIC_URL,
      }),
    );

    /*
     * Deliberately not audited. The audit log has a closed vocabulary of
     * actions and subjects, all of them about a household's own data, and a
     * stranger's words about their child do not belong in the log people read
     * while debugging. The queued messages above are the record, timestamped.
     */

    reply.code(202);
    return {
      message:
        'Thank you — your message is on its way, and a copy is in your inbox. A person reads every one, usually within two working days.',
    };
  });
}
