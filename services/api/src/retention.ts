import { and, eq, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { Database } from './db/client.js';
import {
  auditEvents,
  consentChallenges,
  emailChallenges,
  emailOutbox,
  guardians,
  planOrders,
  refreshTokens,
  sessions,
  usageDays,
} from './db/schema.js';
import { RETENTION } from '@kidpc/shared';

export { RETENTION };

const CODE_LETTERS = ['verify_email', 'sign_in_code', 'password_reset'] as const;

export interface Forgotten {
  unconfirmedSignUps: number;
  letters: number;
  challenges: number;
  refreshTokens: number;
  sessions: number;
  usageDays: number;
  auditEvents: number;
}

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000);
const daysAgo = (now: Date, days: number) => hoursAgo(now, days * 24);

/** `YYYY-MM-DD`, which sorts as text in the same order as the dates. */
const dayKey = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Delete everything that has outlived its purpose.
 *
 * Idempotent and safe to run at any moment: every rule is "older than", so a
 * second run straight after the first finds nothing.
 */
export async function forget(db: Database, now: Date): Promise<Forgotten> {
  const count = async (query: Promise<unknown[]>) => (await query).length;

  return {
    unconfirmedSignUps: await count(
      db
        .delete(guardians)
        .where(
          and(
            isNull(guardians.emailVerifiedAt),
            lt(guardians.createdAt, hoursAgo(now, RETENTION.unconfirmedSignUpHours)),
          ),
        )
        .returning({ id: guardians.id }),
    ),
    letters: await count(
      db
        .delete(emailOutbox)
        .where(
          or(
            lt(emailOutbox.sentAt, daysAgo(now, RETENTION.sentLetterDays)),
            and(
              isNull(emailOutbox.sentAt),
              inArray(emailOutbox.template, [...CODE_LETTERS]),
              lt(emailOutbox.createdAt, hoursAgo(now, RETENTION.undeliveredCodeHours)),
            ),
            and(
              isNull(emailOutbox.sentAt),
              lt(emailOutbox.createdAt, daysAgo(now, RETENTION.undeliveredLetterDays)),
            ),
          ),
        )
        .returning({ id: emailOutbox.id }),
    ),
    challenges:
      (await count(
        db
          .delete(emailChallenges)
          .where(
            or(
              lt(emailChallenges.expiresAt, hoursAgo(now, RETENTION.spentChallengeHours)),
              lt(emailChallenges.usedAt, hoursAgo(now, RETENTION.spentChallengeHours)),
            ),
          )
          .returning({ id: emailChallenges.id }),
      )) +
      (await count(
        db
          .delete(consentChallenges)
          .where(lt(consentChallenges.expiresAt, hoursAgo(now, RETENTION.spentChallengeHours)))
          .returning({ id: consentChallenges.id }),
      )),
    refreshTokens: await count(
      db
        .delete(refreshTokens)
        .where(
          or(
            lt(refreshTokens.expiresAt, now),
            lt(refreshTokens.revokedAt, hoursAgo(now, RETENTION.spentChallengeHours)),
          ),
        )
        .returning({ id: refreshTokens.id }),
    ),
    sessions: await count(
      db
        .delete(sessions)
        .where(
          and(isNotNull(sessions.endedAt), lt(sessions.endedAt, daysAgo(now, RETENTION.sessionDays))),
        )
        .returning({ id: sessions.id }),
    ),
    usageDays: await count(
      db
        .delete(usageDays)
        .where(lt(usageDays.dayKey, dayKey(daysAgo(now, RETENTION.usageDays))))
        .returning({ day: usageDays.dayKey }),
    ),
    auditEvents: await count(
      db
        .delete(auditEvents)
        .where(lt(auditEvents.at, daysAgo(now, RETENTION.auditDays)))
        .returning({ id: auditEvents.id }),
    ),
  };
}

/**
 * The parts of a household that do not hang off the guardian row.
 *
 * Deleting the guardian cascades to every child, session, score and code. What
 * it cannot reach is anything keyed by the email address rather than the id:
 * letters still waiting in the queue, and plan requests. Those go too -- except
 * a plan that was actually paid for, which the tax rules oblige us to keep as a
 * record of the sale. Its link to the (now deleted) account is already cut.
 */
export async function forgetAddress(db: Database, guardianId: string, email: string) {
  const address = email.toLowerCase();
  await db.delete(emailOutbox).where(eq(emailOutbox.toAddress, address));
  await db
    .delete(planOrders)
    .where(
      and(
        or(eq(planOrders.guardianId, guardianId), eq(planOrders.email, address)),
        ne(planOrders.status, 'paid'),
      ),
    );
}
