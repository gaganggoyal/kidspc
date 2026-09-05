/**
 * Icon generator.
 *
 * The app icon has to exist as PNG -- a manifest whose icons are SVG gets a
 * blank tile on Tizen and on older Android launchers -- but committing binaries
 * with no source is how icons rot. So the source is this file: it draws the
 * mark and encodes the PNG itself, using only `node:zlib`. Re-run with
 * `pnpm icons` after changing the mark.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Rgb = [number, number, number];

// Straight from styles.css. Kept in sync by hand; there is exactly one pair.
const GREEN: Rgb = [0x2f, 0x6f, 0x4f];
const CREAM: Rgb = [0xfb, 0xf7, 0xf2];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crcInput = Buffer.concat([head.subarray(4, 8), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([head, data, tail]);
}

/** RGBA pixel buffer -> PNG bytes. Filter 0 on every scanline; deflate does the work. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (1 + width * 4);
    raw[dst] = 0;
    raw.set(rgba.subarray(src, src + width * 4), dst + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * The mark: a friendly screen. Drawn analytically and sampled 3x3 per pixel,
 * because a hard-edged rounded rectangle at 192px looks like a bug.
 */
function draw(size: number, opts: { inset: number; background: Rgb | null; bleed?: boolean }): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const S = 3; // supersampling factor per axis

  // Geometry in 0..1 units, then scaled. `inset` shrinks the mark for maskable
  // icons, where launchers crop to a circle of ~80% of the canvas.
  const pad = (1 - opts.inset) / 2;
  const u = (v: number) => (pad + v * opts.inset) * size;

  const screen = { x0: u(0.16), y0: u(0.2), x1: u(0.84), y1: u(0.68), r: u(0.1) - u(0) };
  const standTop = u(0.68);
  const standBottom = u(0.8);
  const standHalf = (u(0.62) - u(0.38)) / 2;
  const footY0 = u(0.8);
  const footY1 = u(0.86);
  const footX0 = u(0.3);
  const footX1 = u(0.7);
  const eyeR = u(0.048) - u(0);
  const eyeY = u(0.33);
  const eyeLx = u(0.36);
  const eyeRx = u(0.64);
  const smileC = { x: u(0.5), y: u(0.44) };
  const smileR = u(0.145) - u(0);
  const smileW = u(0.035) - u(0);

  const inRoundRect = (x: number, y: number, r: typeof screen) => {
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return false;
    const cx = Math.min(Math.max(x, r.x0 + r.r), r.x1 - r.r);
    const cy = Math.min(Math.max(y, r.y0 + r.r), r.y1 - r.r);
    return Math.hypot(x - cx, y - cy) <= r.r;
  };

  // Maskable icons must fill the square edge to edge: the launcher applies its
  // own mask, and a corner we rounded ourselves shows as a transparent notch
  // under any mask squarer than a circle.
  const bgRadius = opts.bleed ? 0 : size * 0.22;
  const bgRect = { x0: 0, y0: 0, x1: size, y1: size, r: bgRadius };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHits = 0;
      let inkHits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = px + (sx + 0.5) / S;
          const y = py + (sy + 0.5) / S;

          if (opts.background && inRoundRect(x, y, bgRect)) bgHits++;

          const onScreen = inRoundRect(x, y, screen);
          const onStand =
            y >= standTop && y <= standBottom && Math.abs(x - u(0.5)) <= standHalf;
          const onFoot =
            y >= footY0 && y <= footY1 && x >= footX0 && x <= footX1;
          if (onScreen || onStand || onFoot) {
            // Punch the face out of the screen, not out of the stand.
            const d = Math.hypot(x - smileC.x, y - smileC.y);
            const onSmile =
              onScreen && y > smileC.y && Math.abs(d - smileR) <= smileW / 2;
            const onEye =
              onScreen &&
              (Math.hypot(x - eyeLx, y - eyeY) <= eyeR ||
                Math.hypot(x - eyeRx, y - eyeY) <= eyeR);
            if (!onSmile && !onEye) inkHits++;
          }
        }
      }

      const total = S * S;
      const bgA = opts.background ? bgHits / total : 0;
      const inkA = inkHits / total;
      // Ink over background over transparency.
      const ink = opts.background ? CREAM : GREEN;
      const alpha = Math.min(1, bgA + inkA);
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        const base = opts.background ? opts.background[c]! * bgA : 0;
        out[i + c] = Math.round(ink[c]! * inkA + base * (1 - inkA));
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

const here = fileURLToPath(new URL('../apps/web/public/', import.meta.url));

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0.84, background: GREEN },
  { file: 'icon-512.png', size: 512, inset: 0.84, background: GREEN },
  // Maskable: launchers crop to a circle inscribed in 80% of the canvas, so the
  // mark has to sit well inside it while the background bleeds to every edge.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.58, background: GREEN, bleed: true },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.84, background: GREEN },
  { file: 'favicon-48.png', size: 48, inset: 0.84, background: GREEN },
] as const;

for (const t of targets) {
  const png = encodePng(
    t.size,
    t.size,
    draw(t.size, { inset: t.inset, background: t.background, bleed: 'bleed' in t }),
  );
  writeFileSync(here + t.file, png);
  console.log(`${t.file.padEnd(24)} ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)} KiB`);
}
