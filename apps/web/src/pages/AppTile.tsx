import { findApp } from '@kidpc/shared';
import { tileStyle as tileVars } from '../looks';

/**
 * The icon for an app, preferring its own over its category's.
 *
 * Read from the catalogue on the client rather than added to the API response:
 * the catalogue already ships in the bundle, and a glyph is presentation, not
 * something the server should have an opinion about.
 */
export function glyphFor(app: { id: string; category: string }): string {
  return findApp(app.id)?.glyph ?? CATEGORY_GLYPH[app.category] ?? '✨';
}

export const CATEGORY_GLYPH: Record<string, string> = {
  play: '🎮',
  create: '🎨',
  code: '🧩',
  type: '⌨️',
  learn: '🧠',
  office: '📄',
  research: '🔎',
};

interface ShelfApp {
  id: string;
  name: string;
  tagline: string;
  category: string;
}

/**
 * Shelves, in the order a child meets them.
 *
 * Nineteen tiles in one grid is a wall; four labelled rows is a room with
 * things in it. Games first, because that is what a child scans for, and
 * because every shelf after it is one press further down -- the learning is
 * not hidden, it is the next row.
 */
const SHELVES: ReadonlyArray<{ id: string; title: string; categories: readonly string[] }> = [
  { id: 'play', title: '🎮 Games', categories: ['play'] },
  { id: 'learn', title: '🧠 Learn', categories: ['learn', 'type'] },
  { id: 'make', title: '🎨 Make & code', categories: ['create', 'code'] },
  { id: 'write', title: '📖 Write & explore', categories: ['office', 'research'] },
];

export function shelve<T extends ShelfApp>(
  apps: readonly T[],
): Array<{ id: string; title: string; apps: T[] }> {
  const shelves = SHELVES.map((s) => ({
    id: s.id,
    title: s.title,
    apps: apps.filter((a) => s.categories.includes(a.category)),
  }));
  // A category nobody has filed yet still reaches the screen, on the last shelf.
  const filed = new Set(SHELVES.flatMap((s) => s.categories));
  shelves[shelves.length - 1]!.apps.push(...apps.filter((a) => !filed.has(a.category)));
  return shelves.filter((s) => s.apps.length > 0);
}

/**
 * What goes inside a tile. The caller supplies the element -- a button in the
 * launcher, a link in the public arcade -- with `className="tile"` and
 * `style={tileStyle(app.id)}`, because the two differ in what pressing does and
 * nothing else.
 */
export function TileFace({ app, note }: { app: ShelfApp; note?: React.ReactNode }) {
  return (
    <>
      <span className="tile-glyph" aria-hidden="true">
        {glyphFor(app)}
      </span>
      <span className="tile-name">{app.name}</span>
      <span className="tile-line">{app.tagline}</span>
      {note}
    </>
  );
}

/** A tile's colours, as the style prop a tile element takes. */
export function tileStyle(appId: string): React.CSSProperties {
  return tileVars(appId) as React.CSSProperties;
}
