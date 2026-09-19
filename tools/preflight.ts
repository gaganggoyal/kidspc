/**
 * Pre-deployment check.
 *
 * Reads a production env file and refuses to bless it unless everything a live
 * deployment needs is actually in place. Exits non-zero on any failure, so it
 * can gate a deploy rather than being a document someone reads once.
 *
 *   pnpm preflight .env.production
 *
 * It deliberately checks the things that are easy to believe are done: that the
 * consent verifier can actually verify, that DNS points somewhere, that secrets
 * are not the examples from the README.
 */
import { readFile } from 'node:fs/promises';
import { lookup, resolveMx, resolveTxt } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../services/api/src/config.js';
import {
  ConsentUnavailableError,
  createConsentVerifier,
  newConsentNonce,
} from '../services/api/src/consent/verifier.js';

const exec = promisify(execFile);

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

type Level = 'pass' | 'warn' | 'fail';
const results: Array<{ level: Level; name: string; detail: string }> = [];

function record(level: Level, name: string, detail: string) {
  results.push({ level, name, detail });
  const mark = level === 'pass' ? green('PASS') : level === 'warn' ? yellow('WARN') : red('FAIL');
  console.log(`  ${mark}  ${name}`);
  if (detail) console.log(dim(`        ${detail}`));
}

/** Minimal dotenv: enough for `KEY=value`, quoted or not, with comments. */
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

const envPath = process.argv[2] ?? '.env.production';
console.log(`\nKidPC preflight  ${dim(envPath)}\n`);

let fileEnv: Record<string, string>;
try {
  fileEnv = parseEnvFile(await readFile(envPath, 'utf8'));
} catch {
  console.error(red(`Cannot read ${envPath}.`));
  console.error(dim('Copy .env.production.example and fill it in.\n'));
  process.exit(1);
}

const env = { ...fileEnv, NODE_ENV: 'production' } as NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------
console.log('Configuration');

let config: ReturnType<typeof loadConfig> | null = null;
try {
  config = loadConfig(env);
  record('pass', 'Config accepted in production mode', '');
} catch (error) {
  record(
    'fail',
    'Config rejected in production mode',
    (error as Error).message.split('\n').slice(1).join('\n        ').trim(),
  );
}

// ---------------------------------------------------------------------------
console.log('\nSecrets');

const PLACEHOLDERS = [
  'dev-secret-at-least-thirty-two-characters-long',
  'test-secret-that-is-at-least-32-characters-long',
  'dev-consent-pepper-not-for-production',
  'changeme',
  'password',
];

for (const key of ['JWT_SECRET', 'CONSENT_PEPPER', 'POSTGRES_PASSWORD'] as const) {
  const value = fileEnv[key];
  if (!value) {
    record('fail', `${key} is set`, 'Generate one with: openssl rand -base64 48');
    continue;
  }
  if (PLACEHOLDERS.some((p) => value.toLowerCase().includes(p.toLowerCase()))) {
    record('fail', `${key} is not a placeholder`, 'This value appears in the repo. Replace it.');
    continue;
  }
  // Distinct characters is a crude but effective proxy for "was this generated
  // or typed by a human".
  const distinct = new Set(value).size;
  if (value.length < 24 || distinct < 12) {
    record('warn', `${key} looks weak`, `${value.length} chars, ${distinct} distinct.`);
  } else {
    record('pass', `${key} looks generated`, `${value.length} chars, ${distinct} distinct`);
  }
}

if (fileEnv.JWT_SECRET && fileEnv.JWT_SECRET === fileEnv.CONSENT_PEPPER) {
  record('fail', 'JWT_SECRET and CONSENT_PEPPER differ', 'Reusing one secret couples two unrelated compromises.');
}

// ---------------------------------------------------------------------------
console.log('\nDNS');

const domains = [fileEnv.KIDPC_DOMAIN, fileEnv.KIDPC_APPS_DOMAIN].filter(Boolean) as string[];
if (domains.length === 0) {
  record('fail', 'KIDPC_DOMAIN and KIDPC_APPS_DOMAIN are set', 'Caddy needs both to request certificates.');
}
/**
 * Resolving is not enough -- it has to resolve to somewhere Let's Encrypt can
 * reach. A freshly registered domain usually points at its registrar's parking
 * record (BigRock parks at 127.0.0.1), which resolves perfectly and validates
 * never. Treating that as a pass is how a deploy gets to the certificate step
 * before anyone notices.
 */
function addressProblem(address: string): string | null {
  if (address === '::1' || address.startsWith('127.')) return 'loopback (a parking record?)';
  if (address.startsWith('10.') || address.startsWith('192.168.')) return 'private (RFC1918)';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 'private (RFC1918)';
  if (address.startsWith('169.254.')) return 'link-local';
  if (address.startsWith('0.')) return 'unspecified';
  if (/^f[cd]/i.test(address)) return 'unique-local IPv6';
  return null;
}

const resolved = new Map<string, string>();
for (const domain of domains) {
  try {
    const { address } = await lookup(domain);
    resolved.set(domain, address);
    const problem = addressProblem(address);
    if (problem) {
      record(
        'fail',
        `${domain} points at a reachable host`,
        `Resolves to ${address} -- ${problem}.\n        Certificate issuance needs a public A record for this server.`,
      );
    } else {
      record('pass', `${domain} points at a reachable host`, address);
    }
  } catch {
    record(
      'fail',
      `${domain} resolves`,
      'Certificate issuance will fail until an A record points at this host.',
    );
  }
}

if (resolved.size === 2 && new Set(resolved.values()).size === 2) {
  record(
    'warn',
    'Both domains point at the same host',
    `${[...resolved.entries()].map(([d, a]) => `${d} -> ${a}`).join(', ')}. ` +
      'Intentional only if the app bundles are served separately.',
  );
}

// ---------------------------------------------------------------------------
console.log('\nMail -- nothing is delivered without this');

/*
 * Mail was the one part of the system this tool could not see, and it is the
 * part that fails silently by design: with no credentials the service holds
 * the queue rather than dropping it, so everything looks healthy and no
 * message ever arrives. A household that cannot receive a password-reset link
 * cannot get back into their account.
 */
const MAIL_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
const missingMail = MAIL_KEYS.filter((k) => !fileEnv[k]);

if (missingMail.length > 0) {
  record(
    'fail',
    'SMTP credentials are present',
    `Empty or absent: ${missingMail.join(', ')}.\n        ` +
      'Until all four are set the service queues mail and delivers none --\n        ' +
      'which means no welcome email and no password reset.',
  );
} else {
  record('pass', 'SMTP credentials are present', `${fileEnv.SMTP_HOST}:${fileEnv.SMTP_PORT ?? 465}`);

  /*
   * The from-address has to be at a domain we publish records for, or the
   * next three checks are about a domain nobody is sending as.
   */
  const fromAddress = /<([^>]+)>/.exec(fileEnv.SMTP_FROM!)?.[1] ?? fileEnv.SMTP_FROM!;
  const fromDomain = fromAddress.split('@')[1]?.trim().toLowerCase();
  const site = fileEnv.KIDPC_DOMAIN?.toLowerCase();

  if (!fromDomain) {
    record('fail', 'SMTP_FROM is an address', `Got "${fileEnv.SMTP_FROM}". Use name@domain or "Name <name@domain>".`);
  } else if (site && fromDomain !== site && !site.endsWith(`.${fromDomain}`)) {
    record(
      'warn',
      'SMTP_FROM is at the site domain',
      `Sending as ${fromDomain} from ${site}. Deliverable only if ${fromDomain} authorises this sender.`,
    );
  } else {
    record('pass', 'SMTP_FROM is at the site domain', fromAddress);
  }

  if (!fileEnv.ORDERS_EMAIL) {
    record(
      'warn',
      'ORDERS_EMAIL is set',
      'Plan requests and contact-form messages fall back to SMTP_USER. Fine, if somebody reads that mailbox.',
    );
  } else {
    record('pass', 'ORDERS_EMAIL is set', fileEnv.ORDERS_EMAIL);
  }

  if (fromDomain) await checkSenderDns(fromDomain);
}

/**
 * The three records that decide whether a transactional message is read or
 * binned.
 *
 * None of them is optional in practice. A domain with no SPF and no DKIM
 * sending a password-reset link to a Gmail address is the exact profile of a
 * phishing mail, and Google has required one or the other from bulk senders
 * since 2024. This is the check that is easiest to skip and hardest to notice
 * having skipped: mail is accepted by the relay, and lands in spam.
 */
async function checkSenderDns(domain: string) {
  /*
   * "No such record" and "the lookup did not complete" are different answers,
   * and collapsing them is how this tool tells somebody to add an SPF record
   * they already have. Caught while testing against a domain that certainly
   * publishes one: a resolver timeout came back as an empty array and was
   * reported as a FAIL.
   *
   * NXDOMAIN and ENODATA are real absences. Anything else -- a timeout, a
   * refused query, a resolver that is not answering -- is an unknown, and an
   * unknown is a warning that says so.
   */
  const ABSENT = new Set(['ENOTFOUND', 'ENODATA', 'NOTFOUND']);
  type Lookup = { ok: true; records: string[] } | { ok: false; why: string };

  async function txtAt(name: string): Promise<Lookup> {
    try {
      const rows = await resolveTxt(name);
      return { ok: true, records: rows.map((parts) => parts.join('')) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      if (ABSENT.has(code)) return { ok: true, records: [] };
      return { ok: false, why: code };
    }
  }

  const root = await txtAt(domain);
  if (!root.ok) {
    record(
      'warn',
      `${domain} mail records could not be checked`,
      `TXT lookup failed: ${root.why}. This says nothing about the records themselves --\n        ` +
        'check from a machine with a working resolver before acting on it.',
    );
    return;
  }
  const flat = root.records;

  const spf = flat.find((r) => r.toLowerCase().startsWith('v=spf1'));
  if (!spf) {
    record(
      'fail',
      `${domain} publishes an SPF record`,
      'Without it, receiving servers have nothing saying this relay may send as you.\n        ' +
        'Zoho: v=spf1 include:zoho.com ~all',
    );
  } else if (/[?+]all\s*$/.test(spf)) {
    record('warn', `${domain} SPF is restrictive`, `Ends in "${/[?+~-]all/.exec(spf)?.[0]}" -- neutral or pass-all authorises anybody.`);
  } else {
    record('pass', `${domain} publishes an SPF record`, spf);
  }

  const dmarcLookup = await txtAt(`_dmarc.${domain}`);
  const dmarc = dmarcLookup.ok
    ? dmarcLookup.records.find((r) => r.toLowerCase().startsWith('v=dmarc1'))
    : undefined;
  if (!dmarc) {
    record(
      'warn',
      `${domain} publishes a DMARC record`,
      'Start at none and tighten once the reports are clean:\n        ' +
        `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
    );
  } else {
    record('pass', `${domain} publishes a DMARC record`, dmarc);
  }

  /*
   * DKIM cannot be found without knowing the selector, and the selector is
   * chosen by the provider. Checking the handful anybody actually uses is
   * worth more than not checking: a miss here is a warning, never a failure.
   */
  const selectors = ['zoho', 'zmail', 'default', 'google', 's1', 'k1', 'mail'];
  const found: string[] = [];
  for (const selector of selectors) {
    const rows = await txtAt(`${selector}._domainkey.${domain}`);
    if (rows.ok && rows.records.length > 0) found.push(selector);
  }
  if (found.length === 0) {
    record(
      'warn',
      `${domain} publishes a DKIM key`,
      `No key at any of the usual selectors (${selectors.join(', ')}).\n        ` +
        'Either DKIM is not set up, or the selector is one this check does not know.',
    );
  } else {
    record('pass', `${domain} publishes a DKIM key`, `selector: ${found.join(', ')}`);
  }

  // A domain that sends but cannot receive is a domain whose bounces and
  // replies go nowhere -- including the reply to a support message.
  const mx = await resolveMx(domain).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    return ABSENT.has(code) ? [] : null;
  });
  if (mx === null) {
    record('warn', `${domain} can receive mail`, 'MX lookup did not complete.');
  } else if (mx.length === 0) {
    record(
      'warn',
      `${domain} can receive mail`,
      'No MX record. Replies and bounces are undeliverable, and ORDERS_EMAIL at this domain would never arrive.',
    );
  } else {
    record('pass', `${domain} can receive mail`, mx.map((m) => m.exchange).join(', '));
  }
}

// ---------------------------------------------------------------------------
console.log('\nConsent -- the gate on serving any real child');

if (config) {
  try {
    const verifier = createConsentVerifier(config);
    const nonce = newConsentNonce();
    await verifier.begin({ challengeId: 'preflight', nonce, childDisplayName: 'Preflight' });
    // begin() succeeding proves nothing; verification is where the obligation
    // actually lives, so probe it with a proof we know is wrong. A correct
    // implementation returns { ok: false }. An unimplemented one throws.
    const result = await verifier.verify({ challengeId: 'preflight', nonce, proof: 'not-a-proof' });
    if (result.ok) {
      record('fail', `Consent verifier "${verifier.method}" rejects bad proofs`, 'It accepted a proof that was not valid.');
    } else {
      record('pass', `Consent verifier "${verifier.method}" is wired up`, 'Rejected an invalid proof, as it should.');
    }
  } catch (error) {
    const why =
      error instanceof ConsentUnavailableError
        ? error.message.split('.')[0]
        : (error as Error).message;
    record(
      'fail',
      'Consent verification works',
      `${why}.\n        Under the DPDP Act a child's account cannot lawfully be used without\n        verified parental consent. This blocks launch, not just this check.`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\nDesktops');

if ((fileEnv.DEPLOYMENT_MODE ?? 'full') === 'lite') {
  record(
    'pass',
    'Lite deployment -- no desktops to check',
    'Local activities run in the client. No container runtime or image needed.',
  );
} else {
  await checkDesktopImage();
}

async function checkDesktopImage() {
const image = fileEnv.DESKTOP_IMAGE ?? `kidpc/desktop:${fileEnv.DESKTOP_TAG ?? 'latest'}`;
try {
  await exec('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 10_000 });
  const { stdout } = await exec('docker', ['images', '--quiet', image], { timeout: 10_000 });
  if (stdout.trim()) {
    record('pass', `Desktop image ${image} is present`, stdout.trim().split('\n')[0]!);
  } else {
    record(
      'fail',
      `Desktop image ${image} is present`,
      'Build it: docker compose -f infra/docker-compose.yml --profile build build desktop',
    );
  }
} catch {
  record(
    'warn',
    'Docker daemon reachable',
    'Cannot check the desktop image from here. Run this on the deployment host.',
  );
}
}

// ---------------------------------------------------------------------------
const failures = results.filter((r) => r.level === 'fail');
const warnings = results.filter((r) => r.level === 'warn');

console.log(
  `\n${'─'.repeat(64)}\n${results.filter((r) => r.level === 'pass').length} passed, ` +
    `${warnings.length} warning${warnings.length === 1 ? '' : 's'}, ` +
    `${failures.length} failure${failures.length === 1 ? '' : 's'}\n`,
);

if (failures.length > 0) {
  console.log(red('Not ready to deploy. Blocking:'));
  for (const f of failures) console.log(red(`  · ${f.name}`));
  console.log();
  process.exit(1);
}
console.log(green('Ready to deploy.\n'));
