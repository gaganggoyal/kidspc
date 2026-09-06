/**
 * Contrast audit.
 *
 * Reads the palette out of styles.css rather than taking a copy, because a
 * checker with its own hardcoded colours passes long after the design has moved
 * on -- this file existed for ten minutes with a stale hex in it and reported a
 * failure that had already been fixed.
 *
 * Two themes are defined in that file: the `:root` block and the
 * `prefers-color-scheme: dark` override. A colour that passes in one and fails
 * in the other is the normal failure mode, so both are checked.
 *
 *   pnpm contrast        exits non-zero if any pairing fails
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(fileURLToPath(new URL('../apps/web/src/styles.css', import.meta.url)), 'utf8');

/** Pull `--name: #hex;` declarations out of one block of the stylesheet. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

// The first `:root {` block is the light theme; the one inside the dark media
// query overrides it. Later declarations win, which is also how CSS reads it.
const lightBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media (prefers-color-scheme: dark)'));
const darkBlock = CSS.slice(CSS.indexOf('@media (prefers-color-scheme: dark)'));
const light = tokensIn(lightBlock);
const dark = { ...light, ...tokensIn(darkBlock.slice(0, darkBlock.indexOf('\n}\n\n'))) };

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Pairing {
  what: string;
  fg: string;
  bg: string;
  /** 4.5 for body text, 3 for large text and meaningful non-text boundaries. */
  need: number;
  /**
   * WCAG 1.4.11 exempts purely decorative content. The drawn television is
   * aria-hidden and carries no information, so it is reported and not enforced
   * -- but it is still listed, because "invisible on half the devices" is a
   * design bug whether or not a standard has an opinion about it.
   */
  decorative?: boolean;
}

const PAIRINGS: Pairing[] = [
  { what: 'body text on the page', fg: 'ink', bg: 'bg', need: 4.5 },
  { what: 'body text on a card', fg: 'ink', bg: 'surface', need: 4.5 },
  { what: 'muted text on the page', fg: 'ink-soft', bg: 'bg', need: 4.5 },
  { what: 'muted text on a card', fg: 'ink-soft', bg: 'surface', need: 4.5 },
  { what: 'primary button label', fg: 'accent-ink', bg: 'accent', need: 4.5 },
  { what: 'accent mark on the page', fg: 'accent', bg: 'bg', need: 3 },
  { what: 'danger text on a card', fg: 'danger', bg: 'surface', need: 4.5 },
  { what: 'warning text on a card', fg: 'warn', bg: 'surface', need: 4.5 },
  { what: 'television bezel', fg: 'bezel', bg: 'bg', need: 3, decorative: true },
];

let failures = 0;
for (const [name, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  console.log(`\n${name} theme`);
  for (const p of PAIRINGS) {
    const fg = theme[p.fg];
    const bg = theme[p.bg];
    if (!fg || !bg) {
      console.log(`  ????  ${p.what.padEnd(26)} token missing (${p.fg} / ${p.bg})`);
      failures++;
      continue;
    }
    const r = contrast(fg, bg);
    const passed = r >= p.need;
    if (!passed && !p.decorative) failures++;
    const mark = passed ? 'ok  ' : p.decorative ? 'note' : 'FAIL';
    const note = !passed && p.decorative ? '  (decorative, not enforced)' : '';
    console.log(`  ${mark}  ${p.what.padEnd(26)} ${r.toFixed(2).padStart(5)}:1  needs ${p.need}${note}`);
  }
}

console.log(failures === 0 ? '\nAll enforced pairings pass.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
