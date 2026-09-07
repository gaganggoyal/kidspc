/**
 * The order desk.
 *
 * Plan requests arrive with no payment attached, because there is no payment
 * provider wired in. Somebody has to look at them and send a link. This is that
 * somebody's tool, so the job is one command instead of hand-written SQL
 * against a production database at eleven at night.
 *
 * Runs inside the API container, where DATABASE_URL and the mail settings
 * already are:
 *
 *   docker compose exec api pnpm orders list
 *   docker compose exec api pnpm orders send ord_xxx https://rzp.io/l/xxxx
 *   docker compose exec api pnpm orders mail
 *
 * `send` queues the message; `mail` flushes the queue immediately rather than
 * waiting for the next sweep, which matters on a deployment that is holding
 * mail because SMTP was only just configured.
 */
import { asc, desc, eq } from 'drizzle-orm';
import {
  TRIAL_DAYS,
  formatInr,
  normaliseReferralCode,
  planById,
  referralCodeFor,
  referredTrialDays,
} from '@kidpc/shared';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { emailOutbox, guardians, planOrders } from '../db/schema.js';
import { createMailer } from '../email/mailer.js';
import { Outbox, sendPending } from '../email/outbox.js';
import { paymentLinkEmail } from '../email/templates.js';

const config = loadConfig();
const database = await createDatabase(config);
const now = () => new Date();

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.log(`Usage:
  orders list [all]        pending requests, or every request
  orders send <id> <url>   queue the payment link for one request
  orders mail              flush the outbox now
  orders queue             what is waiting to be sent
  orders referrer <code>   whose free month a referral code belongs to`);
  process.exit(1);
}

try {
  switch (command) {
    case 'list': {
      const rows = await database.db
        .select()
        .from(planOrders)
        .orderBy(desc(planOrders.createdAt));
      const shown = args[0] === 'all' ? rows : rows.filter((r) => r.status === 'requested');
      if (shown.length === 0) {
        console.log(args[0] === 'all' ? 'No requests yet.' : 'Nothing waiting.');
        break;
      }
      for (const row of shown) {
        const plan = planById(row.planId);
        console.log(
          [
            row.id,
            row.createdAt.toISOString().slice(0, 16).replace('T', ' '),
            plan.name.padEnd(4),
            `${row.children} child${row.children === 1 ? '' : 'ren'}`.padEnd(11),
            formatInr(row.quotedInr).padStart(8),
            row.status.padEnd(9),
            row.email,
            row.referralCode ? `via ${row.referralCode}` : '',
            row.contactName ?? '',
          ].join('  '),
        );
      }
      console.log(`\n${shown.length} request${shown.length === 1 ? '' : 's'}.`);
      break;
    }

    case 'send': {
      const [id, paymentUrl] = args;
      if (!id || !paymentUrl) usage();
      // A link that is not a link is the one mistake this tool can make on a
      // customer's behalf, and it is not recoverable once the mail is out.
      if (!/^https:\/\//.test(paymentUrl)) {
        console.error('The payment link must be an https URL.');
        process.exit(1);
      }

      const [order] = await database.db.select().from(planOrders).where(eq(planOrders.id, id));
      if (!order) {
        console.error(`No such request: ${id}`);
        process.exit(1);
      }
      if (order.status !== 'requested') {
        // Not fatal, but say so: sending a second link to someone who already
        // paid is worse than a wasted command.
        console.error(`Request ${id} is already "${order.status}". Refusing to send again.`);
        process.exit(1);
      }

      const plan = planById(order.planId);
      const outbox = new Outbox(database.db, now);
      await outbox.enqueue(
        paymentLinkEmail({
          to: order.email,
          contactName: order.contactName,
          plan,
          children: order.children,
          quotedInr: order.quotedInr,
          paymentUrl,
          publicUrl: config.PUBLIC_URL,
          // The trial we already promised them in the confirmation. Recomputed
          // from the stored code rather than remembered, so the two messages
          // cannot come to disagree about how many free days they have.
          trialDays: order.referralCode ? referredTrialDays(TRIAL_DAYS) : TRIAL_DAYS,
        }),
      );
      await database.db
        .update(planOrders)
        .set({ status: 'link_sent' })
        .where(eq(planOrders.id, id));

      console.log(`Queued the payment link to ${order.email} (${formatInr(order.quotedInr)}/month).`);
      console.log('Run "orders mail" to send it now, or wait for the next sweep.');
      break;
    }

    case 'mail': {
      const mailer = createMailer(config);
      if (mailer.name === 'log') {
        console.error(
          'SMTP is not configured, so there is nowhere to send. Set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.',
        );
        process.exit(1);
      }
      const result = await sendPending(database.db, mailer, now, 100);
      console.log(`Sent ${result.sent}, failed ${result.failed}.`);
      break;
    }

    case 'queue': {
      const rows = await database.db
        .select()
        .from(emailOutbox)
        .orderBy(asc(emailOutbox.createdAt));
      const pending = rows.filter((r) => !r.sentAt);
      for (const row of pending) {
        console.log(
          `${row.template.padEnd(15)} ${row.toAddress.padEnd(32)} attempts=${row.attempts}${row.lastError ? `  last error: ${row.lastError}` : ''}`,
        );
      }
      console.log(`\n${pending.length} waiting, ${rows.length - pending.length} sent.`);
      break;
    }

    case 'referrer': {
      const [raw] = args;
      if (!raw) usage();
      const code = normaliseReferralCode(raw);
      if (!code) {
        console.error(`"${raw}" is not a referral code.`);
        process.exit(1);
      }

      /*
       * A scan, because the code is derived from the guardian id rather than
       * stored -- see packages/shared/src/referral.ts. At this scale that is
       * milliseconds, and it means there is no table to keep in step.
       *
       * Every match is printed, not the first. Six characters is about a
       * billion codes, so two guardians sharing one is unlikely rather than
       * impossible, and silently crediting the wrong household a free month is
       * a worse failure than asking a person to choose.
       */
      const all = await database.db.select().from(guardians);
      const matches = all.filter((g) => referralCodeFor(g.id) === code);

      const referred = await database.db
        .select()
        .from(planOrders)
        .where(eq(planOrders.referralCode, code));

      if (matches.length === 0) {
        console.log(`${code} belongs to nobody with an account here.`);
      } else {
        for (const g of matches) {
          console.log(`${code}  ${g.id}  ${g.email}  ${g.displayName}`);
        }
        if (matches.length > 1) {
          console.log('\nMore than one guardian derives this code. Ask, do not guess.');
        }
      }

      console.log(
        `\n${referred.length} household${referred.length === 1 ? '' : 's'} arrived on it:`,
      );
      for (const order of referred) {
        console.log(
          `  ${order.id}  ${order.email.padEnd(32)} ${order.status.padEnd(9)} ${
            order.referralRewardedAt ? 'rewarded' : 'not yet rewarded'
          }`,
        );
      }
      const owed = referred.filter((o) => o.status === 'paid' && !o.referralRewardedAt);
      if (owed.length > 0) {
        console.log(
          `\n${owed.length} of those have paid and the referrer has not been credited.`,
        );
      }
      break;
    }

    default:
      usage();
  }
} finally {
  await database.close();
}
