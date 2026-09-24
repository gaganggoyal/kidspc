/**
 * Writes every public page out as HTML, plus sitemap.xml and robots.txt.
 *
 * Runs after `vite build` (the browser bundle, in dist/) and
 * `vite build --ssr src/prerender.tsx` (the same app, for Node, in dist-ssr/).
 * Each page gets its own <title>, description, canonical address, social
 * preview and structured data, and its content already in the body -- then the
 * same script tags as before, so a visitor's browser takes over as it always
 * has.
 *
 * Everything else (sign-in, the signed-in app) is served app.html: the empty
 * shell, marked noindex, so a parent opening their dashboard never sees the
 * home page flash up first.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);
const ssr = await import(new URL('../dist-ssr/prerender.js', import.meta.url).href);

const template = await readFile(new URL('index.html', dist), 'utf8');
const HEAD = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;
const ROOT = '<div id="root"></div>';
if (!HEAD.test(template) || !template.includes(ROOT)) {
  throw new Error('index.html is missing the <!--seo:start/end--> markers or the empty #root');
}

const write = async (relative, text) => {
  const file = fileURLToPath(new URL(relative, dist));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
};

// The shell for everything that is not prerendered.
await write(
  'app.html',
  template.replace(HEAD, ssr.headTags(ssr.metaFor('/signin')).replace(/<title>.*<\/title>/, '<title>Online Kids PC</title>')),
);

const pages = ssr.publicPages();
for (const page of pages) {
  const body = ssr.render(page.path);
  const html = template.replace(HEAD, ssr.headTags(page)).replace(ROOT, `<div id="root">${body}</div>`);
  await write(page.path === '/' ? 'index.html' : `${page.path.slice(1)}/index.html`, html);
}

// ---- sitemap.xml, with the explainer video on the pages that carry it ----
const today = new Date().toISOString().slice(0, 10);
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const site = ssr.SITE_URL;
const video = ssr.EXPLAINER;
const urls = pages.map((page) => {
  const loc = `${site}${page.path === '/' ? '/' : page.path}`;
  const lines = [
    `  <url>`,
    `    <loc>${esc(loc)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    page.changefreq ? `    <changefreq>${page.changefreq}</changefreq>` : null,
    page.priority !== undefined ? `    <priority>${page.priority.toFixed(1)}</priority>` : null,
  ];
  if (page.video) {
    lines.push(
      `    <video:video>`,
      `      <video:thumbnail_loc>${esc(site + video.poster)}</video:thumbnail_loc>`,
      `      <video:title>${esc(video.title)}</video:title>`,
      `      <video:description>${esc(video.description)}</video:description>`,
      `      <video:content_loc>${esc(site + video.src)}</video:content_loc>`,
      `      <video:duration>${Math.round(video.seconds)}</video:duration>`,
      `      <video:family_friendly>yes</video:family_friendly>`,
      `    </video:video>`,
    );
  }
  lines.push(`  </url>`);
  return lines.filter(Boolean).join('\n');
});
await write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n` +
    `${urls.join('\n')}\n</urlset>\n`,
);

// ---- robots.txt ----
// The signed-in app is kept out: nothing there is useful to a stranger, and a
// search result that lands on a sign-in form is a worse first impression than
// the home page it could have been.
await write(
  'robots.txt',
  [
    'User-agent: *',
    'Allow: /',
    'Disallow: /household',
    'Disallow: /parent',
    'Disallow: /kid',
    'Disallow: /play/',
    'Disallow: /signin',
    'Disallow: /forgot',
    'Disallow: /reset',
    'Disallow: /verify',
    'Disallow: /v1/',
    'Disallow: /sandbox.html',
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n'),
);

console.log(`prerendered ${pages.length} pages, sitemap.xml and robots.txt`);
