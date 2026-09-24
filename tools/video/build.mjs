/**
 * Builds the explainer video from the recorded screens and the script.
 *
 *   node tools/video/capture.mjs   # once, or whenever the app's screens change
 *   node tools/video/build.mjs     # narration, frames, soundtrack, MP4
 *
 * Writes to apps/web/public/media/:
 *   how-it-works.mp4     H.264 + AAC, 1920x1080, fast-start -- plays in every
 *                        TV browser we target, and starts before it has loaded
 *   how-it-works.jpg     the poster, shown until someone presses play
 *   how-it-works.en.vtt  captions, for a parent watching with the sound off
 * and apps/web/public/og.png, the picture a shared link shows.
 *
 * Narration is macOS's own speech (`say`), in an Indian English voice. To use
 * a real voice instead, drop recordings into tools/video/voice/<scene>.m4a --
 * each scene then lasts as long as its recording.
 *
 * Needs macOS (for `say`), ffmpeg, and Google Chrome.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './chrome.mjs';
import { LEAD, SCENES, TAIL } from './script.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RENDER = here('./.render/');
const FRAMES = RENDER + 'frames/';
const MEDIA = here('../../apps/web/public/media/');
const PUBLIC = here('../../apps/web/public/');
const FPS = 30;
const VOICE = process.env.VOICE ?? 'com.apple.voice.Tara.premium';
const RATE = process.env.RATE ?? '172';

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(MEDIA, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const duration = (file) =>
  Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

// ---- 1. narration, and a timeline built from its length ---------------------

let clock = 0;
const scenes = [];
const captions = [];
for (const scene of SCENES) {
  const recorded = ['m4a', 'wav', 'aiff'].map((ext) => here(`./voice/${scene.id}.${ext}`)).find(existsSync);
  const audio = recorded ?? `${RENDER}${scene.id}.aiff`;
  if (!recorded) run('say', ['-v', VOICE, '-r', RATE, '-o', audio, scene.say]);
  const speech = duration(audio);
  const dur = Math.max(scene.min, LEAD + speech + TAIL);
  scenes.push({ id: scene.id, say: scene.say, start: clock, dur, speechStart: LEAD, speechDur: speech, audio });

  // Captions: sentence by sentence (long ones split at a comma or dash), each
  // shown for its share of the spoken time.
  const chunks = scene.text
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => (s.length > 74 ? s.split(/(?<=[,—])\s+/) : [s]));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let at = clock + LEAD;
  chunks.forEach((text, i) => {
    const len = (speech * text.length) / total;
    captions.push({ start: at, end: i === chunks.length - 1 ? at + len + 0.35 : at + len, text });
    at += len;
  });
  clock += dur;
}
const TOTAL = clock;
writeFileSync(
  RENDER + 'timeline.js',
  `window.TIMELINE = ${JSON.stringify({ scenes: scenes.map(({ audio: _audio, ...s }) => s), captions, total: TOTAL })};\n`,
);
console.log(`timeline: ${scenes.length} scenes, ${TOTAL.toFixed(1)}s, voice ${recordedOrVoice()}`);

function recordedOrVoice() {
  return scenes.some((s) => !s.audio.startsWith(RENDER)) ? 'recorded' : VOICE;
}

// ---- 2. frames ------------------------------------------------------------------

const page = await launch({ width: 1920, height: 1080 });
await page.go(`file://${here('./scenes.html')}`, 500);
await page.eval('window.ready');
const presses = await page.eval('window.pressTimes()');

// PREVIEW="scene:seconds,..." draws just those moments, for checking a change
// without rendering three thousand frames. e.g. PREVIEW="code:4,play:6"
if (process.env.PREVIEW) {
  for (const spec of process.env.PREVIEW.split(',')) {
    const [id, offset] = spec.split(':');
    const scene = scenes.find((s) => s.id === id);
    await page.eval(`window.renderAt(${scene.start + Number(offset)}); true`);
    await page.shot(`${RENDER}preview-${id}-${offset}.png`);
  }
  await page.close();
  console.log('previews in', RENDER);
  process.exit(0);
}

const frameCount = Math.ceil(TOTAL * FPS);
for (let i = 0; i < frameCount; i++) {
  await page.eval(`window.renderAt(${(i / FPS).toFixed(4)}); true`);
  const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
  writeFileSync(`${FRAMES}${String(i).padStart(5, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
  if (i % 300 === 0) console.log(`  frame ${i}/${frameCount}`);
}

// The poster: the promise, fully on screen, without a caption over it.
const promise = scenes.find((s) => s.id === 'promise');
await page.eval(`window.renderAt(${promise.start + promise.dur - 0.5}); document.getElementById('caption').style.opacity = 0; true`);
await page.shot(RENDER + 'poster.png');
// The link preview.
await page.eval('window.renderOg(); true');
await page.shot(RENDER + 'og.png');
await page.close();

// ---- 3. soundtrack: the voice, and a soft click for each press of the remote ----

run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=1900:d=0.04', '-af', 'afade=t=out:st=0.004:d=0.036,volume=0.22', RENDER + 'click.wav']);
const inputs = [];
const filters = [];
scenes.forEach((s, i) => {
  inputs.push('-i', s.audio);
  filters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round((s.start + LEAD) * 1000)}[v${i}]`);
});
presses.forEach((t, j) => {
  inputs.push('-i', RENDER + 'click.wav');
  const n = scenes.length + j;
  filters.push(`[${n}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(t * 1000)}[c${j}]`);
});
const labels = [...scenes.map((_, i) => `[v${i}]`), ...presses.map((_, j) => `[c${j}]`)].join('');
filters.push(
  `${labels}amix=inputs=${scenes.length + presses.length}:normalize=0,apad=whole_dur=${TOTAL.toFixed(2)},` +
    `atrim=0:${TOTAL.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[mix]`,
);
run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-c:a', 'aac', '-b:a', '128k', RENDER + 'audio.m4a']);

// ---- 4. the film ------------------------------------------------------------------

run('ffmpeg', [
  '-y', '-v', 'error',
  '-framerate', String(FPS), '-i', FRAMES + '%05d.jpg',
  '-i', RENDER + 'audio.m4a',
  // Frames are JPEGs, which are full-range; TVs expect video range, and some
  // older decoders show yuvj420p washed out or not at all.
  '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-tune', 'stillimage',
  '-profile:v', 'high', '-level', '4.1',
  '-c:a', 'copy', '-shortest', '-movflags', '+faststart',
  MEDIA + 'how-it-works.mp4',
]);
run('ffmpeg', ['-y', '-v', 'error', '-i', RENDER + 'poster.png', '-vf', 'scale=1280:720', '-q:v', '3', MEDIA + 'how-it-works.jpg']);
run('ffmpeg', ['-y', '-v', 'error', '-i', RENDER + 'og.png', '-vf', 'crop=1920:1008:0:36,scale=1200:630', PUBLIC + 'og.png']);

// ---- 5. captions, and the length the site quotes ----------------------------------

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((ms / 60_000) % 60)).padStart(2, '0');
  const s = String(Math.floor((ms / 1000) % 60)).padStart(2, '0');
  return `${h}:${m}:${s}.${String(ms % 1000).padStart(3, '0')}`;
};
writeFileSync(
  MEDIA + 'how-it-works.en.vtt',
  'WEBVTT\n\n' + captions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'),
);

const seconds = Math.round(duration(MEDIA + 'how-it-works.mp4'));
const explainer = here('../../apps/web/src/explainer.ts');
writeFileSync(explainer, readFileSync(explainer, 'utf8').replace(/seconds: \d+,/, `seconds: ${seconds},`));

const size = (f) => `${(Number(run('stat', ['-f', '%z', f]).trim()) / 1024 / 1024).toFixed(1)} MB`;
console.log(`how-it-works.mp4  ${seconds}s  ${size(MEDIA + 'how-it-works.mp4')}`);
