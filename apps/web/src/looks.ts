/**
 * Each activity's colour.
 *
 * On a television a child finds an app by colour and shape long before they
 * read its name, the way they find a favourite cereal on a shelf. A launcher
 * where every tile is the same white card is a launcher that has to be read.
 *
 * Every pair is dark enough to carry white text at 4.5:1 at both ends of the
 * gradient -- `pnpm contrast` imports this list and checks it, so a colour
 * that looks lovely and cannot be read does not make it past the checker.
 *
 * Presentation only, so it lives in the client rather than the catalogue: the
 * server has no business knowing that Snake is green.
 */
export const TILE_PALETTE = {
  violet: ['#7c3aed', '#4c1d95'],
  indigo: ['#4f46e5', '#312e81'],
  blue: ['#1d4ed8', '#1e3a8a'],
  sky: ['#0369a1', '#0c4a6e'],
  cyan: ['#0e7490', '#164e63'],
  teal: ['#0f766e', '#134e4a'],
  green: ['#15803d', '#14532d'],
  amber: ['#b45309', '#78350f'],
  orange: ['#c2410c', '#7c2d12'],
  red: ['#dc2626', '#7f1d1d'],
  rose: ['#be123c', '#881337'],
  pink: ['#be185d', '#831843'],
  fuchsia: ['#a21caf', '#701a75'],
  slate: ['#475569', '#1e293b'],
} as const satisfies Record<string, readonly [string, string]>;

export type TileColour = keyof typeof TILE_PALETTE;

const BY_APP: Record<string, TileColour> = {
  paint: 'fuchsia',
  typing: 'green',
  blocks: 'indigo',
  numbers: 'amber',
  memory: 'violet',
  spell: 'sky',
  piano: 'slate',
  gcompris: 'teal',
  writer: 'rose',
  tables: 'orange',
  india: 'teal',
  scratch: 'amber',
  files: 'slate',
  research: 'cyan',
  code: 'blue',
  thonny: 'green',
  office: 'sky',
  snake: 'green',
  tictactoe: 'blue',
  fourrow: 'red',
  echo: 'violet',
  maze: 'cyan',
  slide: 'indigo',
  bricks: 'orange',
  merge: 'amber',
};

const ORDER = Object.keys(TILE_PALETTE) as TileColour[];

export function tileColour(appId: string): TileColour {
  const known = BY_APP[appId];
  if (known) return known;
  // Something added to the catalogue without a colour still gets a stable one.
  let hash = 0;
  for (const ch of appId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return ORDER[hash % ORDER.length]!;
}

/** The two custom properties a `.tile` reads its gradient from. */
export function tileStyle(appId: string): Record<'--tile-a' | '--tile-b', string> {
  const [a, b] = TILE_PALETTE[tileColour(appId)];
  return { '--tile-a': a, '--tile-b': b };
}
