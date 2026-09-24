/**
 * The mail path, from this machine to an inbox.
 *
 * Mail is the one subsystem here that fails quietly on purpose: with no
 * credentials the service holds the queue rather than dropping it, so nothing
 * looks broken and nothing arrives. That is the right behaviour and a terrible
 * thing to debug, so this exists to make each step visible separately.
 *
 *   pnpm mail check                  is the provider set up, and the domain proved?
 *   pnpm mail check --create         ...and add the domain to Resend if it is missing
 *   pnpm mail send you@example.com   send one real letter, now
 *   pnpm mail link [address]         read a queued code or link out of the outbox
 *
 * What is waiting in general is `pnpm orders queue`; `link` is the one thing it
 * does not do, and the one somebody needs at the moment a parent is locked out
 * and mail is not yet working.
 *
 * Run these on the deployment host, inside the API container -- that is where
 * the credentials and the database are, and "it works from my laptop" is not
 * the question being asked:
 *
 *   docker compose exec api pnpm mail check
 */
import { readFile } from 'node:fs/promises';
import { desc, inArray } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { chooseTransport, createMailer, smtpConfigured } from '../email/mailer.js';
import { mailTestEmail } from '../email/templates.js';
import { createDatabase } from '../db/client.js';
import { emailOutbox } from '../db/schema.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
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
const create = rest.includes('--create');

const COMMANDS = ['check', 'send', 'link'] as const;

/* Before the config is even read: somebody typing `pnpm mail` wants to know
 * what the commands are, not to be told that a key is unset. */
if (!command || !(COMMANDS as readonly string[]).includes(command)) {
  console.log('\n  pnpm mail check                  is the provider set up, and the domain proved?');
  console.log('  pnpm mail check --create         ...and add the domain to Resend if it is missing');
  console.log('  pnpm mail send you@example.com   send one real letter');
  console.log('  pnpm mail link [address]         read a queued code or link out of the outbox');
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

const transport = chooseTransport(config);

if (transport === 'log' && command !== 'link') {
  console.error(red('\nNo mail transport is configured, so there is nothing to test.\n'));
  console.error('For Resend, both of these must be set:');
  for (const [key, value] of [
    ['RESEND_API_KEY', config.RESEND_API_KEY],
    ['MAIL_FROM', config.mailFrom],
  ] as const) {
    console.error(`  ${value ? green('set  ') : red('EMPTY')}  ${key}`);
  }
  console.error(dim('\nSee docs/deploy.md, "Mail".\n'));
  process.exit(1);
}

switch (command) {
  case 'check':
    await (transport === 'resend' ? checkResend() : checkSmtp());
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

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

interface ResendRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status: string;
}

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: ResendRecord[];
}

async function resend(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config!.RESEND_API_KEY}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** The domain half of "Name <name@domain>". */
function fromDomain(): string | null {
  const from = config!.mailFrom ?? '';
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return address.includes('@') ? address.split('@')[1]!.trim().toLowerCase() : null;
}

/**
 * Is the key accepted, and has Resend proved the domain the From line uses?
 *
 * The domain is the thing that is actually wrong almost every time: a key is
 * copied once and works, while DNS records are added by hand at a registrar,
 * one of them lands on the wrong name, and every letter is refused with
 * "domain is not verified". So this prints each record Resend wants, with
 * whether it has seen it yet -- the list to hand to whoever has the DNS login.
 */
async function checkResend() {
  const domain = fromDomain();
  console.log(`\nResend, sending as ${config!.mailFrom}`);
  if (!domain) {
    console.error(red('\n  MAIL_FROM has no address in it. Use "Name <name@domain>".\n'));
    process.exitCode = 1;
    return;
  }

  const list = await resend('/domains');
  if (!list.ok) {
    const message = String(list.body.message ?? `HTTP ${list.status}`);
    if (list.status === 401 && /restricted/i.test(message)) {
      // A sending-only key cannot read domains. That is the right kind of key
      // for the server to hold; it just cannot answer this question.
      console.log(yellow('\n  This key can send but not read domains, which is the right key for a server.'));
      console.log('  Check the domain in the Resend dashboard, then prove the path end to end:');
      console.log(dim('  pnpm mail send you@example.com\n'));
      return;
    }
    console.error(red(`\n  FAILED  ${message}\n`));
    if (list.status === 401 || list.status === 403) {
      console.error('  The key was refused. Create a new one at resend.com/api-keys.\n');
    }
    process.exitCode = 1;
    return;
  }

  const domains = (list.body.data ?? []) as ResendDomain[];
  let found = domains.find((d) => d.name.toLowerCase() === domain);
  if (!found) {
    if (!create) {
      console.error(red(`\n  ${domain} is not in this Resend account.\n`));
      console.error(`  Add it with: pnpm mail check --create`);
      console.error(dim(`  In the account now: ${domains.map((d) => d.name).join(', ') || '(nothing)'}\n`));
      process.exitCode = 1;
      return;
    }
    const made = await resend('/domains', { method: 'POST', body: JSON.stringify({ name: domain }) });
    if (!made.ok) {
      console.error(red(`\n  Could not add ${domain}: ${String(made.body.message ?? made.status)}\n`));
      process.exitCode = 1;
      return;
    }
    console.log(green(`\n  Added ${domain} to Resend.`));
    found = made.body as unknown as ResendDomain;
  }

  const detail = await resend(`/domains/${found.id}`);
  const full = (detail.ok ? detail.body : found) as unknown as ResendDomain;
  const verified = full.status === 'verified';
  console.log(
    `\n  ${verified ? green('VERIFIED') : yellow(full.status.toUpperCase())}  ${full.name}`,
  );

  const records = full.records ?? [];
  if (records.length > 0) {
    console.log(dim('\n  DNS records Resend checks, at the registrar for ' + domain + ':\n'));
    for (const r of records) {
      const mark = r.status === 'verified' ? green('ok     ') : yellow(r.status.padEnd(7));
      const host = r.name === '@' || r.name === '' ? domain : `${r.name}.${domain}`;
      console.log(`  ${mark} ${r.type.padEnd(5)} ${host}`);
      console.log(dim(`          ${r.priority !== undefined ? `priority ${r.priority}  ` : ''}${r.value}`));
    }
  }
  console.log(
    dim(
      '\n  Also worth adding: TXT _dmarc.' +
        domain +
        '  "v=DMARC1; p=none; rua=mailto:' +
        (config!.MAIL_REPLY_TO ?? `hello@${domain}`) +
        '"',
    ),
  );

  if (verified) {
    console.log(green('\n  Resend will send as this domain.'));
    console.log(dim('  Next: pnpm mail send you@example.com\n'));
  } else {
    console.log(
      '\n  Add the records above, wait a few minutes, then press Verify in the Resend dashboard' +
        '\n  (or run this again). Until then every letter is refused and kept in the queue.\n',
    );
    if (create) await resend(`/domains/${found.id}/verify`, { method: 'POST' });
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

/**
 * Does the relay accept us?
 *
 * `verify()` opens a connection, negotiates TLS and authenticates, then hangs
 * up without sending. It separates "the credentials are wrong" from "the
 * message was rejected", which are the two failures that look identical in a
 * log line that only says mail did not go out.
 */
async function checkSmtp() {
  if (!smtpConfigured(config!)) return;
  console.log(
    `\nConnecting to ${config!.SMTP_HOST}:${config!.SMTP_PORT} ${dim(config!.SMTP_SECURE ? '(implicit TLS)' : '(STARTTLS)')}`,
  );
  const nodemailer = await import('nodemailer');
  const smtp = nodemailer.createTransport({
    host: config!.SMTP_HOST!,
    port: config!.SMTP_PORT,
    secure: config!.SMTP_SECURE,
    auth: { user: config!.SMTP_USER!, pass: config!.SMTP_PASS! },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  try {
    await smtp.verify();
    console.log(green('\n  OK  the relay accepted these credentials.\n'));
    console.log(dim(`  Sending as: ${config!.mailFrom}`));
    console.log(dim('  Next: pnpm mail send you@example.com\n'));
  } catch (error) {
    const message = (error as Error).message;
    console.error(red(`\n  FAILED  ${message}\n`));
    console.error(hint(message));
    process.exitCode = 1;
  } finally {
    smtp.close();
  }
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

/** One real letter, through the same Mailer and the same frame the service uses. */
async function send() {
  if (!recipient) {
    console.error(red('\nWhich address? e.g. pnpm mail send you@example.com\n'));
    process.exit(2);
  }
  const mailer = createMailer(config!);
  const letter = mailTestEmail({
    to: recipient,
    transport: mailer.name,
    from: config!.mailFrom ?? '(unset)',
    publicUrl: config!.PUBLIC_URL,
    at: new Date(),
  });
  console.log(`\nSending to ${recipient} via ${mailer.name}…`);
  try {
    await mailer.send(letter);
    console.log(green('\n  SENT  the provider accepted the letter.\n'));
    console.log('  Now go and look in the inbox — and in the spam folder.');
    console.log(dim('  Landing in spam means it was delivered and SPF/DKIM/DMARC are not right yet.\n'));
  } catch (error) {
    const message = (error as Error).message;
    console.error(red(`\n  FAILED  ${message}\n`));
    console.error(hint(message));
    process.exitCode = 1;
  }
}

/**
 * Read a queued code or link out of the outbox.
 *
 * The reason this exists: until mail is delivering, the queue is the only
 * place a sign-up code or a reset link exists at all, and somebody supporting a
 * locked-out parent has to be able to hand it over. It is also the fastest way
 * to prove the flows work end to end before mail does.
 *
 * Only unsent letters, and only the newest -- a spent code is not worth reading
 * out, and asking for a new one revokes the previous one anyway.
 */
async function link() {
  const handle = await createDatabase(config!);
  try {
    const rows = await handle.db
      .select()
      .from(emailOutbox)
      .where(inArray(emailOutbox.template, ['verify_email', 'sign_in_code', 'password_reset']))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(100);
    const row = rows.find(
      (r) => r.sentAt === null && (!recipient || r.toAddress.toLowerCase() === recipient.toLowerCase()),
    );

    if (!row) {
      console.log(dim(`\n  No undelivered code is queued${recipient ? ` for ${recipient}` : ''}.`));
      console.log(dim('  Ask for one at ' + config!.PUBLIC_URL + '/signin, then run this again.\n'));
      return;
    }
    const code = /Your code: (\d{3} \d{3})/.exec(row.bodyText)?.[1];
    const url = /https?:\/\/\S*\/(?:reset|verify)\?token=\S+/.exec(row.bodyText)?.[0];
    const kind = { verify_email: 'sign-up', sign_in_code: 'sign-in', password_reset: 'password reset' }[
      row.template as 'verify_email' | 'sign_in_code' | 'password_reset'
    ];
    console.log(
      `\n  A ${kind} letter, queued ${row.createdAt.toISOString().slice(0, 16).replace('T', ' ')} for ${row.toAddress}`,
    );
    if (row.lastError) console.log(red(`  Last attempt failed: ${row.lastError.split('\n')[0]}`));
    if (code) console.log(green(`\n  Code: ${code}`));
    if (url) console.log(green(`  Link: ${url}`));
    console.log(dim('\n  Either works once. Asking for another cancels this one.\n'));
  } finally {
    await handle.close();
  }
}

/** The failures that account for almost every one of these. */
function hint(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not verified') || m.includes('domain')) {
    return (
      '  The provider has not proved the domain in MAIL_FROM yet. Run `pnpm mail check`\n' +
      '  for the DNS records it is waiting for.\n'
    );
  }
  if (m.includes('api key') || m.includes('resend 401') || m.includes('resend 403')) {
    return '  The API key was refused. Create a sending key at resend.com/api-keys.\n';
  }
  if (m.includes('invalid login') || m.includes('authentication') || m.includes('535')) {
    return (
      '  Most likely: SMTP_PASS is the account password rather than an app-specific\n' +
      '  password. Providers with two-factor authentication reject the account\n' +
      '  password over SMTP. Generate an app password and use that.\n'
    );
  }
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused')) {
    return (
      '  Most likely: the port is blocked. Many hosts block outbound mail ports, which is\n' +
      '  one reason Resend (HTTPS, port 443) is the preferred transport here.\n'
    );
  }
  if (m.includes('self signed') || m.includes('certificate')) {
    return '  TLS negotiation failed. Confirm SMTP_SECURE matches the port: 465 is implicit TLS, 587 is STARTTLS.\n';
  }
  if (m.includes('relay') || m.includes('553') || m.includes('550')) {
    return (
      '  The relay would not send as MAIL_FROM. It usually has to be the\n' +
      '  authenticated mailbox, or an alias the provider knows about.\n'
    );
  }
  return '';
}
