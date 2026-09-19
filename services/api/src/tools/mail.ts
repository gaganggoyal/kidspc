/**
 * The mail path, from this machine to an inbox.
 *
 * Mail is the one subsystem here that fails quietly on purpose: with no
 * credentials the service holds the queue rather than dropping it, so nothing
 * looks broken and nothing arrives. That is the right behaviour and a terrible
 * thing to debug, so this exists to make each step visible separately.
 *
 *   pnpm mail check                  can we open an authenticated session?
 *   pnpm mail send you@example.com   send one real message, now
 *   pnpm mail link                   read a queued password-reset link out
 *
 * What is waiting in general is `pnpm orders queue`, which already existed;
 * `link` is the one thing it does not do, and the one somebody needs at the
 * moment a parent is locked out and mail is not yet working.
 *
 * Run these on the deployment host, inside the API container -- that is where
 * the credentials and the database are, and "it works from my laptop" is not
 * the question being asked:
 *
 *   docker compose exec api pnpm mail check
 */
import { readFile } from 'node:fs/promises';
import { desc, isNull } from 'drizzle-orm';
import { PRODUCT_NAME } from '@kidpc/shared';
import { loadConfig } from '../config.js';
import { createMailer, smtpConfigured } from '../email/mailer.js';
import { createDatabase } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

const [command, ...rest] = process.argv.slice(2);
const envPath = rest.find((a) => a.includes('.env'));
const recipient = rest.find((a) => a.includes('@'));

const COMMANDS = ['check', 'send', 'link'] as const;

/* Before the config is even read: somebody typing `pnpm mail` wants to know
 * what the commands are, not to be told that SMTP is unset. */
if (!command || !(COMMANDS as readonly string[]).includes(command)) {
  console.log('\n  pnpm mail check                  open an authenticated SMTP session');
  console.log('  pnpm mail send you@example.com   send one real message');
  console.log('  pnpm mail link                   read a queued password-reset link out');
  console.log(dim('\n  What is queued in general: pnpm orders queue'));
  console.log(dim('\n  Reads the environment. Pass a path to an env file to use that instead.\n'));
  process.exit(2);
}


/*
 * `process.env` by default, a file only when asked.
 *
 * The same choice `orders` makes, and for the same reason: the place this is
 * meant to be run is inside the API container, where compose has already put
 * every setting into the environment. Defaulting to a path would mean the
 * command works on a laptop and fails in the one place the credentials
 * actually live.
 */
let config;
try {
  config = envPath
    ? loadConfig({
        ...parseEnvFile(await readFile(envPath, 'utf8')),
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv)
    : loadConfig();
} catch (error) {
  console.error(red(`\nCannot load configuration${envPath ? ` from ${envPath}` : ''}:`));
  console.error((error as Error).message.split('\n').slice(0, 6).join('\n'));
  console.error(dim('\nRun this inside the API container, or pass a path to an env file.\n'));
  process.exit(1);
}

if (!smtpConfigured(config) && command !== 'link') {
  console.error(red('\nSMTP is not configured, so there is nothing to test.\n'));
  console.error('All four of these must be set:');
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const) {
    console.error(`  ${config[key] ? green('set  ') : red('EMPTY')}  ${key}`);
  }
  console.error(dim('\nSee docs/deploy.md, "Mail".\n'));
  process.exit(1);
}

switch (command) {
  case 'check':
    await check();
    break;
  case 'send':
    await send();
    break;
  case 'link':
    await link();
    break;
  default:
    // Unreachable: the guard above exits on anything not in COMMANDS.
    break;
}

/**
 * Does the relay accept us?
 *
 * `verify()` opens a connection, negotiates TLS and authenticates, then hangs
 * up without sending. It separates "the credentials are wrong" from "the
 * message was rejected", which are the two failures that look identical in a
 * log line that only says mail did not go out.
 */
async function check() {
  console.log(`\nConnecting to ${config!.SMTP_HOST}:${config!.SMTP_PORT} ${dim(config!.SMTP_SECURE ? '(implicit TLS)' : '(STARTTLS)')}`);
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: config!.SMTP_HOST!,
    port: config!.SMTP_PORT,
    secure: config!.SMTP_SECURE,
    auth: { user: config!.SMTP_USER!, pass: config!.SMTP_PASS! },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  try {
    await transport.verify();
    console.log(green('\n  OK  the relay accepted these credentials.\n'));
    console.log(dim(`  Sending as: ${config!.SMTP_FROM}`));
    console.log(dim('  Next: pnpm mail send you@example.com\n'));
  } catch (error) {
    const message = (error as Error).message;
    console.error(red(`\n  FAILED  ${message}\n`));
    console.error(hint(message));
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}

/** One real message, through the same Mailer the service uses. */
async function send() {
  if (!recipient) {
    console.error(red('\nWhich address? e.g. pnpm mail send you@example.com\n'));
    process.exit(2);
  }
  const mailer = createMailer(config!);
  console.log(`\nSending to ${recipient} via ${mailer.name}…`);
  try {
    await mailer.send({
      to: recipient,
      subject: `${PRODUCT_NAME} test message`,
      text:
        `This is a test from the ${PRODUCT_NAME} deployment.\n\n` +
        `If you are reading it, SMTP is working: welcome emails and password-reset links will be delivered.\n\n` +
        `Sent at ${new Date().toISOString()} from ${config!.PUBLIC_URL}.\n`,
    });
    console.log(green('\n  SENT  the relay accepted the message.\n'));
    console.log('  Now go and look in the inbox — and in the spam folder.');
    console.log(dim('  Landing in spam means the message was delivered and SPF/DKIM are not right yet.\n'));
  } catch (error) {
    const message = (error as Error).message;
    console.error(red(`\n  FAILED  ${message}\n`));
    console.error(hint(message));
    process.exitCode = 1;
  }
}

/**
 * Read a queued password-reset link out of the outbox.
 *
 * The reason this exists: until SMTP is configured the queue is the only place
 * a reset link exists at all, and somebody supporting a locked-out parent has
 * to be able to hand it over. It is also the fastest way to prove the reset
 * flow works end to end before mail does.
 *
 * Only unsent messages, and only the newest -- a spent link is not worth
 * reading out, and issuing a new request revokes the previous one anyway.
 */
async function link() {
  const handle = await createDatabase(config!);
  try {
    const [row] = await handle.db
      .select()
      .from(emailOutbox)
      .where(isNull(emailOutbox.sentAt))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(50)
      .then((rows) => rows.filter((r) => r.template === 'password_reset'));

    if (!row) {
      console.log(dim('\n  No undelivered password-reset message is queued.'));
      console.log(dim('  Ask for one at ' + config!.PUBLIC_URL + '/forgot, then run this again.\n'));
      return;
    }
    const url = /https?:\/\/\S*\/reset\?token=\S+/.exec(row.bodyText)?.[0];
    console.log(`\n  Queued ${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')} for ${row.toAddress}`);
    if (row.lastError) console.log(red(`  Last attempt failed: ${row.lastError.split('\n')[0]}`));
    if (!url) {
      console.log(red('\n  The message carries no link, which should not happen.\n'));
      process.exitCode = 1;
      return;
    }
    console.log(green('\n  ' + url + '\n'));
    console.log(dim('  It works once, and expires an hour after it was asked for.\n'));
  } finally {
    await handle.close();
  }
}

/** The four failures that account for almost every one of these. */
function hint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login') || m.includes('authentication') || m.includes('535')) {
    return (
      '  Most likely: SMTP_PASS is the account password rather than an app-specific\n' +
      '  password. Providers with two-factor authentication reject the account\n' +
      '  password over SMTP. Generate an app password and use that.\n'
    );
  }
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused')) {
    return (
      '  Most likely: the port is blocked. Many hosts block outbound 25 and some\n' +
      '  block 587. Port 465 with SMTP_SECURE=1 is the one that usually survives.\n' +
      '  Check from the host itself: nc -vz ' + config!.SMTP_HOST + ' ' + config!.SMTP_PORT + '\n'
    );
  }
  if (m.includes('self signed') || m.includes('certificate')) {
    return '  TLS negotiation failed. Confirm SMTP_SECURE matches the port: 465 is implicit TLS, 587 is STARTTLS.\n';
  }
  if (m.includes('relay') || m.includes('553') || m.includes('550')) {
    return (
      '  The relay would not send as SMTP_FROM. It usually has to be the\n' +
      '  authenticated mailbox, or an alias the provider knows about.\n'
    );
  }
  return '';
}
