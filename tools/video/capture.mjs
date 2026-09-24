/**
 * Records the real screens the explainer video shows.
 *
 * Drives the app the way a family would -- a TV-sized browser with arrow keys
 * and OK, a phone for the parent -- and saves a screenshot at each moment the
 * video needs. Real screens, not mock-ups: when the app changes, run this
 * again and the video shows the new app.
 *
 * Needs the dev servers (`pnpm dev`) and the demo household (`pnpm --filter
 * @kidpc/api seed`). Writes to tools/video/.capture/.
 *
 *   node tools/video/capture.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './chrome.mjs';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const EMAIL = 'demo@kidpc.test';
const PASSWORD = 'demo-password-1234';
const OUT = fileURLToPath(new URL('./.capture/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const at = (name) => OUT + name;
const facts = {};

// ---- set the household up so the screens look lived-in ---------------------

const api = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(`${WEB}/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

const { accessToken: parent } = await api('/auth/login', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD },
});
const me = await api('/me', { token: parent });
const meera = (me.children ?? []).find((c) => c.displayName === 'Meera');
if (!meera) throw new Error('No Meera in the demo household. Run: pnpm --filter @kidpc/api seed');

// An hour a day, so there is time on her ring whatever the demo was used for
// earlier today -- the way a parent would give more time, from the dashboard.
await api(`/children/${meera.id}/policy`, {
  method: 'PUT',
  token: parent,
  body: {
    dailyMinutes: 60,
    weeklyMinutes: null,
    allowedWindows: [],
    allowedAppIds: meera.policy.allowedAppIds,
    sessionSummaries: false,
    idleTimeoutMinutes: meera.policy.idleTimeoutMinutes,
  },
});

// A few personal bests, so her tiles carry trophies the way a real child's do.
const { accessToken: child } = await api('/auth/child/login', {
  method: 'POST',
  token: parent,
  body: { childId: meera.id, pin: '1111' },
});
for (const [appId, metric, value] of [
  ['snake', 'score', 42],
  ['numbers', 'puzzles_solved', 18],
  ['memory', 'score', 9],
  ['echo', 'level', 7],
]) {
  await api('/progress', { method: 'POST', token: child, body: { appId, metric, value } }).catch(() => {});
}
// End anything left running, so her launcher opens on its home screen.
const live = await api('/sessions/current', { token: child }).catch(() => null);
if (live?.id) await api(`/sessions/${live.id}/end`, { method: 'POST', token: child }).catch(() => {});

// ---- the television ----------------------------------------------------------

// 960 x 540 at twice the density: what a TV browser actually lays out on a
// 1080p set (Silk on Fire TV reports exactly this), so the frames show the
// size things really are on a television.
const tv = await launch({ width: 960, height: 540, scale: 2 });
const hideDevNotes = () =>
  tv.eval(`document.querySelectorAll('.notice.small').forEach((n) => { if (/Development/.test(n.textContent)) n.remove(); }); true`);

await tv.go(`${WEB}/`, 2500);
await tv.shot(at('tv-home.png'));

// Sign in with an emailed code, as a parent would on a TV.
await tv.go(`${WEB}/signin?code=1`, 2000);
// The address the letter on the phone is written to, so the two agree. An
// address with no account gets the same "check your email" screen -- the
// server says the same thing either way, on purpose.
await tv.eval(`document.querySelector('input[type=email]').focus(); true`);
await tv.type('priya@example.com', 25);
await tv.key('Enter');
await sleep(1500);
// The digits the video shows, and the letter on the phone carries. Typed for
// the camera but never sent: the real code for a sign-in request is only in
// the server's mail log, and five digits on a screen is the moment worth
// showing. The sign-in itself is done with the demo password, off camera.
const code = '482915';
facts.code = code;
await hideDevNotes();
await tv.shot(at('tv-code-0.png'));
for (let i = 0; i < 5; i++) {
  await tv.type(code[i], 60);
  await hideDevNotes();
  await tv.shot(at(`tv-code-${i + 1}.png`));
}
await tv.go(`${WEB}/signin`, 1500);
await tv.eval(`document.querySelector('input[type=email]').focus(); true`);
await tv.type(EMAIL, 10);
await tv.eval(`document.querySelector('input[type=password]').focus(); true`);
await tv.type(PASSWORD, 10);
await tv.key('Enter', 2500);

// Who is playing? Focus moves with the arrows.
await tv.eval(`location.pathname`).then((p) => {
  if (!p.startsWith('/household')) throw new Error(`expected /household after the code, at ${p}`);
});
await tv.shot(at('tv-house-0.png'));
await tv.key('ArrowRight');
await tv.shot(at('tv-house-1.png'));
await tv.key('ArrowLeft');
await tv.shot(at('tv-house-2.png'));
await tv.key('Enter', 900);

// Her code, on the keypad, with OK on "1" four times.
await tv.eval(
  `[...document.querySelectorAll('.pinpad button')].find((b) => b.textContent.trim() === '1').focus(); true`,
);
await tv.shot(at('tv-pin-0.png'));
for (let i = 1; i <= 3; i++) {
  await tv.key('Enter', 200);
  await tv.shot(at(`tv-pin-${i}.png`));
}
await tv.key('Enter', 2500);

// Her home screen, and the remote moving across it.
await tv.shot(at('tv-launch-0.png'));
await tv.key('ArrowDown');
await tv.key('ArrowDown');
await tv.shot(at('tv-launch-1.png'));
await tv.key('ArrowRight');
await tv.shot(at('tv-launch-2.png'));
await tv.key('ArrowRight');
await tv.shot(at('tv-launch-3.png'));

// Snake: focus it, press OK, and watch it go.
await tv.eval(
  `[...document.querySelectorAll('button.tile')].find((b) => /Snake/.test(b.textContent)).focus(); true`,
);
await tv.shot(at('tv-launch-snake.png'));
await tv.key('Enter', 3000);
// Its first screen asks how fast. Gentle, as a seven-year-old would choose.
await tv.eval(
  `[...document.querySelectorAll('button')].find((b) => /Gentle/.test(b.textContent)).focus(); true`,
);
await tv.key('Enter', 600);
const turns = ['ArrowUp', null, null, 'ArrowRight', null, null, 'ArrowDown', null, null, 'ArrowRight', null, null];
for (let i = 0; i < 24; i++) {
  const turn = turns[i % turns.length];
  if (turn) await tv.key(turn, 0);
  await sleep(170);
  await tv.shot(at(`tv-snake-${i}.png`));
}

// Snake is still "going" as far as the server knows; end it, so her home
// screen is the plain one rather than "Carry on".
const playing = await api('/sessions/current', { token: child }).catch(() => null);
if (playing?.id) await api(`/sessions/${playing.id}/end`, { method: 'POST', token: child }).catch(() => {});

// Back home, then the moment the day's minutes are gone. The app shows this
// state only after real minutes have been used, so it is drawn here with the
// app's own classes and its own words (packages/policy/src/evaluate.ts).
await tv.go(`${WEB}/household`, 1500);
await tv.eval(
  `[...document.querySelectorAll('.profile')].find((b) => /Meera/.test(b.textContent)).focus(); true`,
);
await tv.key('Enter', 900);
await tv.eval(
  `[...document.querySelectorAll('.pinpad button')].find((b) => b.textContent.trim() === '1').focus(); true`,
);
for (let i = 0; i < 4; i++) await tv.key('Enter', 200);
await sleep(2500);
await tv.eval(`(() => {
  const ring = document.querySelector('.time-ring');
  ring.classList.remove('low'); ring.classList.add('out');
  const fill = ring.querySelector('.fill');
  fill.setAttribute('stroke-dashoffset', fill.getAttribute('stroke-dasharray'));
  ring.querySelector('b').textContent = 'No time';
  const used = ring.querySelector('.time-ring-text .small');
  used.textContent = used.textContent.replace(/\\d+ of (\\d+)/, '$1 of $1');
  const notice = document.createElement('div');
  notice.className = 'notice bad';
  notice.innerHTML = "<strong>You've used all your computer time for today. See you tomorrow!</strong>";
  document.querySelector('.stage-top').after(notice);
  document.querySelectorAll('main button').forEach((b) => (b.disabled = true));
  document.activeElement?.blur();
  return true;
})()`);
await sleep(300);
await tv.shot(at('tv-timeup.png'));
await tv.close();

// ---- the parent's phone ---------------------------------------------------------

const phone = await launch({ width: 390, height: 844, scale: 2, mobile: true });
await phone.go(`${WEB}/signin`, 1500);
await phone.eval(`document.querySelector('input[type=email]').focus(); true`);
await phone.type(EMAIL, 10);
await phone.eval(`document.querySelector('input[type=password]').focus(); true`);
await phone.type(PASSWORD, 10);
await phone.key('Enter', 2500);
await phone.go(`${WEB}/parent`, 3000);
// The part a parent comes here for: one child's minutes, hours and activities.
await phone.eval(`(() => {
  const label = [...document.querySelectorAll('h2, h3, label, legend')].find((el) => /minutes/i.test(el.textContent));
  (label?.closest('section, form, .card') ?? label)?.scrollIntoView({ block: 'start' });
  window.scrollBy(0, -12);
  return true;
})()`);
await sleep(500);
await phone.shot(at('phone-parent.png'));

// The letter with the code in it, exactly as the service renders it.
const letter = at('letter.html');
execFileSync(
  fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url)),
  [fileURLToPath(new URL('./letter.ts', import.meta.url)), code, letter],
  { stdio: 'inherit' },
);
await phone.go(`file://${letter}`, 800);
await phone.shot(at('phone-letter.png'));
await phone.close();

writeFileSync(at('facts.json'), JSON.stringify(facts, null, 2));
console.log('captured', facts);
