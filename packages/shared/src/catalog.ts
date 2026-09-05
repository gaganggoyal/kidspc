import { type AgeBand, bandAtLeast } from './age.js';

/**
 * How the desktop session actually starts an activity.
 *
 * `native` runs a binary already baked into the desktop image. `web` opens a
 * URL in the locked-down kid browser. Everything reachable from a session is
 * declared here, so the catalogue doubles as the source of truth for the
 * network allow-list -- there is no way to add an app without also declaring
 * the origins it is allowed to talk to.
 */
export type LaunchSpec =
  | { kind: 'native'; exec: string; args?: string[] }
  | {
      kind: 'web';
      url: string;
      /**
       * True when we serve the app ourselves. Self-hosting is how we get
       * Scratch and friends without dragging a child into a social network
       * or an ad/tracking surface, which DPDP Rules 2025 bar outright.
       */
      selfHosted: boolean;
    };

export type AppCategory = 'create' | 'code' | 'type' | 'learn' | 'office' | 'research';

export interface CatalogApp {
  id: string;
  name: string;
  /** One line, written for a child to read on a TV from three metres away. */
  tagline: string;
  category: AppCategory;
  /** Lowest band this app is offered to; higher bands inherit it. */
  minBand: AgeBand;
  launch: LaunchSpec;
  /** Extra origins this app needs, beyond its own URL. */
  extraOrigins?: string[];
  /** Rough RAM ceiling in MiB, used for session sizing. */
  memoryHintMib: number;
}

/**
 * The curated catalogue. Deliberately small: every entry is something a parent
 * would recognise as learning, and each one is reviewed before it lands here.
 * A large open app store is the thing we are explicitly not building.
 */
export const CATALOG: readonly CatalogApp[] = [
  // ---- Explorer (5-8) -----------------------------------------------------
  {
    id: 'tuxpaint',
    name: 'Paint',
    tagline: 'Draw, stamp and colour',
    category: 'create',
    minBand: 'explorer',
    launch: { kind: 'native', exec: 'tuxpaint' },
    memoryHintMib: 180,
  },
  {
    id: 'gcompris',
    name: 'Play & Learn',
    tagline: 'Puzzles, letters and numbers',
    category: 'learn',
    minBand: 'explorer',
    launch: { kind: 'native', exec: 'gcompris-qt' },
    memoryHintMib: 320,
  },
  {
    id: 'tuxtype',
    name: 'Typing Game',
    tagline: 'Catch the falling letters',
    category: 'type',
    minBand: 'explorer',
    launch: { kind: 'native', exec: 'tuxtype' },
    memoryHintMib: 160,
  },
  {
    id: 'blockly-puzzles',
    name: 'Block Puzzles',
    tagline: 'Snap blocks together to solve mazes',
    category: 'code',
    minBand: 'explorer',
    launch: { kind: 'web', url: 'https://apps.kidpc.internal/blockly/', selfHosted: true },
    memoryHintMib: 260,
  },

  // ---- Builder (9-12) -----------------------------------------------------
  {
    id: 'scratch',
    name: 'Scratch',
    tagline: 'Build your own games and stories',
    category: 'code',
    minBand: 'builder',
    launch: { kind: 'web', url: 'https://apps.kidpc.internal/scratch/', selfHosted: true },
    memoryHintMib: 520,
  },
  {
    id: 'files',
    name: 'My Files',
    tagline: 'Keep your projects tidy',
    category: 'office',
    minBand: 'builder',
    launch: { kind: 'native', exec: 'pcmanfm' },
    memoryHintMib: 120,
  },
  {
    id: 'research',
    name: 'Look It Up',
    tagline: 'Search a small, safe corner of the web',
    category: 'research',
    minBand: 'builder',
    launch: { kind: 'web', url: 'https://apps.kidpc.internal/research/', selfHosted: true },
    extraOrigins: [
      'https://kids.britannica.com',
      'https://simple.wikipedia.org',
      'https://upload.wikimedia.org',
      'https://ncert.nic.in',
    ],
    memoryHintMib: 420,
  },
  {
    id: 'blocks-to-python',
    name: 'Blocks to Python',
    tagline: 'Watch your blocks turn into real code',
    category: 'code',
    minBand: 'builder',
    launch: { kind: 'web', url: 'https://apps.kidpc.internal/edublocks/', selfHosted: true },
    memoryHintMib: 380,
  },

  // ---- Coder (13-16) ------------------------------------------------------
  {
    id: 'thonny',
    name: 'Python',
    tagline: 'Write and run real Python',
    category: 'code',
    minBand: 'coder',
    launch: { kind: 'native', exec: 'thonny' },
    memoryHintMib: 420,
  },
  {
    id: 'web-sandbox',
    name: 'Web Sandbox',
    tagline: 'HTML, CSS and JavaScript with live preview',
    category: 'code',
    minBand: 'coder',
    launch: { kind: 'web', url: 'https://apps.kidpc.internal/sandbox/', selfHosted: true },
    memoryHintMib: 480,
  },
  {
    id: 'office',
    name: 'Homework',
    tagline: 'Documents, slides and spreadsheets',
    category: 'office',
    minBand: 'coder',
    launch: { kind: 'native', exec: 'libreoffice', args: ['--writer'] },
    memoryHintMib: 640,
  },
] as const;

const BY_ID = new Map(CATALOG.map((a) => [a.id, a]));

export function findApp(id: string): CatalogApp | undefined {
  return BY_ID.get(id);
}

/** Everything a band is *eligible* for, before a parent's allow-list narrows it. */
export function appsForBand(band: AgeBand): CatalogApp[] {
  return CATALOG.filter((app) => bandAtLeast(band, app.minBand));
}

export function defaultAllowedAppIds(band: AgeBand): string[] {
  return appsForBand(band).map((a) => a.id);
}

/**
 * Origins a session may reach, derived from the apps it is allowed to launch.
 * The desktop's egress proxy is configured from exactly this list, so an app
 * that was never granted cannot smuggle in a domain.
 */
export function originsForApps(apps: readonly CatalogApp[]): string[] {
  const origins = new Set<string>();
  for (const app of apps) {
    if (app.launch.kind === 'web') origins.add(new URL(app.launch.url).origin);
    for (const extra of app.extraOrigins ?? []) origins.add(new URL(extra).origin);
  }
  return [...origins].sort();
}

/** Peak RAM we should budget for a session allowed to run `apps`. */
export function memoryBudgetMib(apps: readonly CatalogApp[]): number {
  // A child runs one or two things at a time, not the whole catalogue. Budget
  // for the two heaviest plus the desktop shell rather than the naive sum.
  const heaviest = [...apps].sort((a, b) => b.memoryHintMib - a.memoryHintMib).slice(0, 2);
  const apps_ = heaviest.reduce((sum, a) => sum + a.memoryHintMib, 0);
  const SHELL_OVERHEAD_MIB = 420; // Xorg + window manager + VNC server
  return apps_ + SHELL_OVERHEAD_MIB;
}
