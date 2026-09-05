/**
 * A guided tour of a running KidPC.
 *
 * Drives the live API the way the client does and narrates what happens, so
 * the behaviour that is otherwise spread across a parent dashboard, a TV
 * launcher and a 45-minute wait can be seen in one screen of output.
 *
 *   pnpm dev            # in one terminal
 *   pnpm demo           # in another
 *
 * It leaves the demo household exactly as it found it.
 */
import { type AgeBand, originsForApps } from '@kidpc/shared';
import { visibleApps } from '@kidpc/policy';

const BASE = process.env.KIDPC_URL ?? 'http://localhost:4000';
const EMAIL = 'demo@kidpc.test';
const PASSWORD = 'demo-password-1234';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function step(title: string) {
  console.log(`\n${bold(`── ${title} `.padEnd(72, '─'))}`);
}
function note(text: string) {
  console.log(dim(`   ${text}`));
}

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

interface Child {
  id: string;
  displayName: string;
  band: AgeBand;
  age: number;
  policy: { dailyMinutes: number; allowedAppIds: string[]; [k: string]: unknown };
}

const health = await fetch(`${BASE}/healthz`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(red(`\nNothing is listening on ${BASE}. Start it with:  pnpm dev\n`));
  process.exit(1);
}

console.log(bold('\nKidPC guided tour'));
note(`api ${BASE} · desktop driver: ${health.driver}`);
if (health.driver === 'loopback') {
  note('The loopback driver simulates desktops. Sessions, time and limits are');
  note('real; there is no actual Linux desktop behind them.');
}

// ---------------------------------------------------------------------------
step('A parent signs in');
const login = await call<{ accessToken: string }>('/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD },
});
if (login.status !== 200) {
  console.error(red(`\nCould not sign in as ${EMAIL}. Seed the demo household first:`));
  console.error(red('  pnpm --filter @kidpc/api seed\n'));
  process.exit(1);
}
const parent = login.accessToken ?? login.body.accessToken;

const me = await call<{ guardian: { displayName: string }; children: Child[] }>('/me', {
  token: parent,
});
console.log(`   ${me.body.guardian.displayName} has ${me.body.children.length} children:`);
for (const c of me.body.children) {
  console.log(
    `     ${c.displayName.padEnd(7)} age ${String(c.age).padEnd(3)} ${c.band.padEnd(9)} ` +
      `${String(c.policy.dailyMinutes).padStart(3)} min/day   ${c.policy.allowedAppIds.length} apps`,
  );
}
note('Defaults get more generous with age, and are set when the profile is made.');

// ---------------------------------------------------------------------------
step('Each child sees a different computer');
const pins: Record<string, string> = { Meera: '1111', Ravi: '2222', Anaya: '3333' };
const tokens: Record<string, string> = {};

for (const child of me.body.children) {
  const res = await call<{ accessToken: string }>('/auth/child/login', {
    method: 'POST',
    token: parent,
    body: { childId: child.id, pin: pins[child.displayName] },
  });
  tokens[child.displayName] = res.body.accessToken;

  const home = await call<{ apps: Array<{ id: string }>; time: { remainingMinutes: number } }>(
    '/home',
    { token: res.body.accessToken },
  );
  console.log(
    `   ${child.displayName.padEnd(7)} ${String(home.body.time.remainingMinutes).padStart(3)} min left   ` +
      home.body.apps.map((a) => a.id).join(', '),
  );
}
note('Age gating is not cosmetic: the launcher only ever receives what the');
note("child's band allows, intersected with what their parent left switched on.");

// ---------------------------------------------------------------------------
step('A 7-year-old asks for the Python IDE');
const denied = await call<{ error: { code: string; message: string } }>('/sessions', {
  method: 'POST',
  token: tokens.Meera,
  body: { appId: 'thonny' },
});
console.log(`   HTTP ${denied.status}  ${red(denied.body.error.code)}`);
console.log(`   She is told: "${denied.body.error.message}"`);
note('A machine-readable code for the client, and a sentence a child can read.');

// ---------------------------------------------------------------------------
step('Ravi starts Scratch');
const started = await call<{ id: string; grantedMinutes: number; streamPath: string }>('/sessions', {
  method: 'POST',
  token: tokens.Ravi,
  body: { appId: 'scratch', deviceKind: 'tv' },
});
console.log(`   session ${started.body.id}`);
console.log(`   granted ${green(`${started.body.grantedMinutes} minutes`)}, stream at ${started.body.streamPath}`);
note('The grant is frozen now: the minimum of his remaining daily budget, any');
note('weekly cap, the end of his allowed window, and a hard 180-minute ceiling.');
note('Nothing about where the desktop actually lives crosses the wire.');

const ticket = await call<{ expiresInSeconds: number }>(`/sessions/${started.body.id}/ticket`, {
  method: 'POST',
  token: tokens.Ravi,
});
console.log(`   stream ticket valid for ${ticket.body.expiresInSeconds}s, bound to this session only`);

// ---------------------------------------------------------------------------
step('His sister tries to touch his session');
const meddle = await call(`/sessions/${started.body.id}/heartbeat`, {
  method: 'POST',
  token: tokens.Anaya,
});
console.log(`   HTTP ${meddle.status} ${meddle.status === 404 ? green('not found') : red('LEAK')}`);
note('404, not 403 — she should not even learn the session exists.');

// ---------------------------------------------------------------------------
step('What his desktop is allowed to reach');
const ravi = me.body.children.find((c) => c.displayName === 'Ravi')!;

// The same derivation the control plane hands the egress proxy: the origins
// declared by the apps this child is actually allowed to open, and nothing else.
const granted = visibleApps({ allowedAppIds: ravi.policy.allowedAppIds }, ravi.band as AgeBand);
for (const origin of originsForApps(granted)) console.log(`   ${green('allow')}  ${origin}`);
for (const blockedHost of ['https://www.youtube.com', 'https://mail.google.com']) {
  console.log(`   ${red('deny ')}  ${blockedHost}`);
}
note('Default-deny. The desktop sits on a network with no route out; its only');
note('exit is a proxy that authorises it per session against exactly this list.');
note('Switch off the research app and the encyclopaedia origins close within a');
note('minute, without restarting the desktop.');

// ---------------------------------------------------------------------------
step('Time runs out');
const original = ravi.policy;
await call(`/children/${ravi.id}/policy`, {
  method: 'PUT',
  token: parent,
  body: { ...original, dailyMinutes: 0 },
});
const blocked = await call<{ canStart: boolean; blocked: { reason: string; message: string; retryAt: string } }>(
  '/home',
  { token: tokens.Ravi },
);
console.log(`   canStart: ${red(String(blocked.body.canStart))}  (${blocked.body.blocked.reason})`);
console.log(`   He is told: "${blocked.body.blocked.message}"`);
console.log(`   Comes back: ${new Date(blocked.body.blocked.retryAt).toLocaleString()}`);
note('His existing session keeps running — the lease was already granted. A');
note('parent editing a number in another room does not yank a child off mid-task.');

// ---------------------------------------------------------------------------
step('Putting everything back');
await call(`/children/${ravi.id}/policy`, { method: 'PUT', token: parent, body: original });
await call(`/sessions/${started.body.id}/end`, { method: 'POST', token: tokens.Ravi });
const final = await call<{ time: { usedTodayMinutes: number; remainingMinutes: number } }>('/home', {
  token: tokens.Ravi,
});
console.log(`   Ravi used ${final.body.time.usedTodayMinutes} min today, ${final.body.time.remainingMinutes} left.`);

console.log(`\n${bold('Now try the UI:')} http://localhost:5173`);
console.log(`   sign in ${EMAIL} / ${PASSWORD}, then pick a child (PINs above).\n`);
