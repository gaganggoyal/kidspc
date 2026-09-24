import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { newId } from '@kidpc/shared';
import type { Database } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';
import type { Composed } from './templates.js';
import type { Mailer } from './mailer.js';

/**
 * The queue between "something happened" and "a message was delivered".
 *
 * Every send in this service goes through here. Nothing calls a Mailer
 * directly, so there is exactly one place where a message can be lost, one
 * place that retries, and one row to look at when a parent says they never
 * received anything.
 */
export class Outbox {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: Database,
    private readonly now: () => Date,
  ) {}

  /**
   * Told whenever something is queued, so the sender can go now rather than
   * at its next sweep. A sign-in code that arrives a minute after it was asked
   * for is a parent standing at a television wondering whether it worked.
   */
  onEnqueue(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queue a composed message. Returns its id so a caller can log the link. */
  async enqueue(message: Composed): Promise<string> {
    const id = newId('eml');
    await this.db.insert(emailOutbox).values({
      id,
      toAddress: message.to,
      subject: message.subject,
      bodyText: message.text,
      bodyHtml: message.html,
      template: message.template,
      createdAt: this.now(),
      nextTryAt: this.now(),
    });
    this.listeners.forEach((listener) => listener());
    return id;
  }

  async pendingCount(): Promise<number> {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(emailOutbox)
      .where(isNull(emailOutbox.sentAt));
    return rows[0]?.n ?? 0;
  }
}

/**
 * Retry schedule. Roughly a minute, five, half an hour, two hours, then daily.
 *
 * Capped rather than unbounded because the common failure is not transient:
 * it is a mailbox that does not exist, or credentials that were never
 * configured. Those should be retried slowly and kept, not hammered and not
 * dropped -- the row is the evidence that someone asked us for something.
 */
const BACKOFF_MINUTES = [1, 5, 30, 120, 1440];

export function backoffMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)]!;
}

export interface SenderResult {
  sent: number;
  failed: number;
}

/**
 * Drains due messages, oldest first.
 *
 * Sends serially on purpose. The volume here is a handful of messages a day,
 * and a mail provider is far more likely to rate-limit a burst than to mind a
 * slow trickle -- concurrency would buy nothing and risk the reputation of a
 * domain that also carries other sites' mail.
 */
export async function sendPending(
  db: Database,
  mailer: Mailer,
  now: () => Date,
  limit = 20,
): Promise<SenderResult> {
  const at = now();
  const due = await db
    .select()
    .from(emailOutbox)
    .where(and(isNull(emailOutbox.sentAt), lte(emailOutbox.nextTryAt, at)))
    .orderBy(asc(emailOutbox.nextTryAt))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await mailer.send({
        to: row.toAddress,
        subject: row.subject,
        text: row.bodyText,
        html: row.bodyHtml,
        idempotencyKey: row.id,
      });
      // Delivered, so the letter lives in the recipient's inbox now. Keeping
      // our own copy would make this table a second mailbox nobody reads --
      // holding sign-in codes, links, and whatever a parent wrote on the
      // contact form. The row stays a while as a receipt; the words do not.
      await db
        .update(emailOutbox)
        .set({ sentAt: now(), attempts: row.attempts + 1, lastError: null, bodyText: '', bodyHtml: null })
        .where(eq(emailOutbox.id, row.id));
      sent++;
    } catch (cause) {
      const attempts = row.attempts + 1;
      await db
        .update(emailOutbox)
        .set({
          attempts,
          // Truncated: an SMTP rejection can carry a whole essay, and the first
          // line is the part that says what went wrong.
          lastError: String(cause instanceof Error ? cause.message : cause).slice(0, 500),
          nextTryAt: new Date(now().getTime() + backoffMinutes(attempts) * 60_000),
        })
        .where(eq(emailOutbox.id, row.id));
      failed++;
    }
  }
  return { sent, failed };
}
