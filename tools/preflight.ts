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
import { lookup } from 'node:dns/promises';
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
