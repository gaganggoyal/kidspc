import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

/**
 * Does anything spill sideways?
 *
 * A page that scrolls horizontally on a phone is the single most common
 * responsive defect and the easiest to miss, because it only shows up at widths
 * nobody develops at. This checks every public route at every width the traffic
 * actually arrives on, and names the element responsible rather than just
 * failing -- a report that says "something overflows at 360px" costs an
 * afternoon; one that says ".home-nav-links, 380px wide" costs a minute.
 *
 * Two things make this less obvious than it sounds:
 *
 * 1. Headless Chrome will not open a window narrower than 500px, so a 360px
 *    screenshot is a crop of a 500px render and lies. Every measurement here
 *    happens inside a same-origin iframe sized to the target width, which has
 *    no such floor.
 * 2. Scrollbars. Measuring `scrollWidth > innerWidth` on a document with a
 *    classic scrollbar is off by its width, so the frame is told to hide them.
 *
 * Signed-in screens are not covered: reaching them needs a session, and a
 * layout check that requires a seeded database is one nobody runs.
 */
const ROUTES = [
  '/',
  '/try',
  '/try/paint',
  '/try/blocks',
  '/try/numbers',
  '/try/typing',
  '/try/writer',
  '/try/code',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/refunds',
  '/delivery',
  '/signin',
];

/** Small phone, phones, phablet, small tablet, tablet, laptop, desktop, TV. */
const WIDTHS = [320, 360, 390, 414, 480, 600, 768, 834, 1024, 1280, 1440, 1920, 2560];

const DIST = resolve('apps/web/dist');
const TOLERANCE = 1; // sub-pixel layout rounding is not an overflow

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function chromeBinary(): string {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('No Chrome found. Set CHROME to its path.');
  return found;
}

/** The dist directory, with the SPA fallback the real edge also serves. */
function serve(probe: string): Promise<{ port: number; close: () => void }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const file =
      path === '/__probe' ? probe : existsSync(join(DIST, path)) && extname(path) ? join(DIST, path) : null;
    if (!file) {
      res.writeHead(200, { 'content-type': 'text/html' });
      createReadStream(join(DIST, 'index.html')).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) throw new Error('no port');
      ready({ port: address.port, close: () => server.close() });
    });
  });
}

const PROBE = `<!doctype html><meta charset="utf-8"><title>…</title>
<style>html,body{margin:0}iframe{border:0;display:block}</style>
<iframe id="f" scrolling="no"></iframe>
<script>
const ROUTES = ${JSON.stringify(ROUTES)};
const WIDTHS = ${JSON.stringify(WIDTHS)};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const f = document.getElementById('f');

async function check(route, width) {
  f.style.width = width + 'px';
  f.style.height = Math.round(width * 0.66) + 'px';
  await new Promise((done) => {
    f.addEventListener('load', done, { once: true });
    f.src = route + '?_=' + width;
  });
  await wait(120);
  const win = f.contentWindow, doc = f.contentDocument;
  // Hide scrollbars inside the frame: a classic scrollbar takes real width and
  // would read as an overflow of its own size on every page.
  const hide = doc.createElement('style');
  hide.textContent = '::-webkit-scrollbar{display:none}html{scrollbar-width:none}';
  doc.head.appendChild(hide);
  await wait(40);

  const limit = win.innerWidth;
  const over = doc.documentElement.scrollWidth - limit;
  let culprit = null;
  if (over > ${TOLERANCE}) {
    // The deepest element that sticks out is the one worth naming; its parents
    // stick out only because it does.
    for (const el of doc.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limit + ${TOLERANCE}) continue;
      if (!culprit || r.right >= culprit.right) {
        const id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
        culprit = { right: Math.round(r.right), width: Math.round(r.width), id };
      }
    }
  }
  return { route, width, over: Math.round(over), culprit };
}

(async () => {
  const results = [];
  for (const route of ROUTES) for (const width of WIDTHS) results.push(await check(route, width));
  const out = document.createElement('pre');
  out.id = 'results';
  out.textContent = JSON.stringify(results);
  document.body.appendChild(out);
  document.title = 'done';
})();
</script>`;

const probeFile = join(mkdtempSync(join(tmpdir(), 'kidpc-layout-')), 'probe.html');
writeFileSync(probeFile, PROBE);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No build to check. Run: pnpm --filter @kidpc/web build');
  process.exit(2);
}

const { port, close } = await serve(probeFile);
const dom = await new Promise<string>((done, fail) => {
  const child = spawn(
    chromeBinary(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--window-size=2600,900',
      `--virtual-time-budget=${ROUTES.length * WIDTHS.length * 400 + 20_000}`,
      '--dump-dom',
      `http://127.0.0.1:${port}/__probe`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.on('error', fail);
  child.on('close', () => done(out));
});
close();

interface Result {
  route: string;
  width: number;
  over: number;
  culprit: { right: number; width: number; id: string } | null;
}

const match = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);
if (!match) {
  console.error('The probe did not finish. Chrome may have been killed, or a route threw.');
  process.exit(2);
}
const results: Result[] = JSON.parse(
  match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
);

const failures = results.filter((r) => r.over > TOLERANCE);
console.log(`${results.length} checks — ${ROUTES.length} routes × ${WIDTHS.length} widths\n`);
if (failures.length === 0) {
  console.log('Nothing overflows. Every public route fits every width from 320 to 2560.');
  process.exit(0);
}
for (const f of failures) {
  console.log(
    `  ${f.route.padEnd(14)} ${String(f.width).padStart(5)}px  +${f.over}px  ${f.culprit?.id ?? '(unknown)'} ` +
      `(${f.culprit?.width}px wide, right edge at ${f.culprit?.right})`,
  );
}
console.log(`\n${failures.length} of ${results.length} checks overflow.`);
process.exit(1);
