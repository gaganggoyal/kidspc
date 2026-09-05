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
  /**
   * Runs in the client's own browser. Costs the server nothing per concurrent
   * child beyond the static file, which is what makes the whole product viable
   * on a small VPS: a streamed desktop is ~1.5 GiB of RAM, a local activity is
   * a route. Everything that can be delivered this way should be.
   */
  | { kind: 'local'; route: string }
  /** A binary in the desktop image. Needs a provisioned Linux session. */
  | { kind: 'native'; exec: string; args?: string[] }
  /**
   * An app we serve ourselves, opened in the desktop's locked-down browser.
   *
   * Self-hosting is how Scratch and friends reach a child without dragging
   * them into a social network or an ad surface, which DPDP Rules 2025 bar
   * outright. The origin is deliberately absent: it differs between
   * development, staging and production, and baking one into the domain model
   * is what stops the same build serving all three.
   */
  | { kind: 'web'; path: string; selfHosted: true }
  /** A third-party origin, declared in full because it is outside our control. */
  | { kind: 'web'; url: string; selfHosted: false };

/** A launch spec with its origin filled in, ready to hand to a desktop. */
export type ResolvedLaunch =
  | { kind: 'local'; route: string }
  | { kind: 'native'; exec: string; args?: string[] }
  | { kind: 'web'; url: string };

/**
 * How an activity reaches the child.
 *
 * `local` needs nothing but the client. `hosted` needs a streamed Linux
 * desktop, which is the expensive half of this product -- so the split is a
 * first-class part of the model rather than an implementation detail, and a
 * deployment can be configured to offer only the cheap half.
 */
export type Delivery = 'local' | 'hosted';

export function deliveryOf(spec: LaunchSpec): Delivery {
  return spec.kind === 'local' ? 'local' : 'hosted';
}

/** Where self-hosted app bundles are served from, when nothing else is set. */
export const DEFAULT_APPS_ORIGIN = 'https://apps.kidspc.online';

export function resolveLaunch(spec: LaunchSpec, appsOrigin: string): ResolvedLaunch {
  if (spec.kind === 'native' || spec.kind === 'local') return spec;
  if (spec.selfHosted) return { kind: 'web', url: new URL(spec.path, appsOrigin).toString() };
  return { kind: 'web', url: spec.url };
}

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
  /**
   * Rough RAM ceiling in MiB on a streamed desktop. Zero for local activities,
   * which consume the client's memory rather than ours -- that zero is the
   * whole reason lite deployments fit on a small VPS.
   */
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
    id: 'paint',
    name: 'Paint',
    tagline: 'Draw, stamp and colour',
    category: 'create',
    minBand: 'explorer',
    launch: { kind: 'local', route: '/play/paint' },
    memoryHintMib: 0,
  },
  {
    id: 'typing',
    name: 'Typing Garden',
    tagline: 'Grow a plant by finding the right keys',
    category: 'type',
    minBand: 'explorer',
    launch: { kind: 'local', route: '/play/typing' },
    memoryHintMib: 0,
  },
  {
    id: 'blocks',
    name: 'Block Puzzles',
    tagline: 'Stack blocks to guide the robot home',
    category: 'code',
    minBand: 'explorer',
    launch: { kind: 'local', route: '/play/blocks' },
    memoryHintMib: 0,
  },
  {
    id: 'numbers',
    name: 'Number Ninja',
    tagline: 'Sharpen your maths, one problem at a time',
    category: 'learn',
    minBand: 'explorer',
    launch: { kind: 'local', route: '/play/numbers' },
    memoryHintMib: 0,
  },
  {
    id: 'gcompris',
    name: 'Play & Learn',
    tagline: 'A hundred small activities',
    category: 'learn',
    minBand: 'explorer',
    launch: { kind: 'native', exec: 'gcompris-qt' },
    memoryHintMib: 320,
  },

  // ---- Builder (9-12) -----------------------------------------------------
  {
    id: 'writer',
    name: 'Story Writer',
    tagline: 'Write stories and homework',
    category: 'office',
    minBand: 'builder',
    launch: { kind: 'local', route: '/play/writer' },
    memoryHintMib: 0,
  },
  {
    id: 'scratch',
    name: 'Scratch',
    tagline: 'Build your own games and stories',
    category: 'code',
    minBand: 'builder',
    launch: { kind: 'web', path: '/scratch/', selfHosted: true },
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
    launch: { kind: 'web', path: '/research/', selfHosted: true },
    extraOrigins: [
      'https://kids.britannica.com',
      'https://simple.wikipedia.org',
      'https://upload.wikimedia.org',
      'https://ncert.nic.in',
    ],
    memoryHintMib: 420,
  },

  // ---- Coder (13-16) ------------------------------------------------------
  {
    id: 'code',
    name: 'Code Playground',
    tagline: 'HTML, CSS and JavaScript with live preview',
    category: 'code',
    minBand: 'coder',
    launch: { kind: 'local', route: '/play/code' },
    memoryHintMib: 0,
  },
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

/** Activities that run in the client and need no server-side desktop. */
export function localApps(apps: readonly CatalogApp[]): CatalogApp[] {
  return apps.filter((app) => deliveryOf(app.launch) === 'local');
}

/** Activities that require a provisioned Linux desktop. */
export function hostedApps(apps: readonly CatalogApp[]): CatalogApp[] {
  return apps.filter((app) => deliveryOf(app.launch) === 'hosted');
}

export function appDelivery(appId: string): Delivery | null {
  const app = findApp(appId);
  return app ? deliveryOf(app.launch) : null;
}

/**
 * Origins a session may reach, derived from the apps it is allowed to launch.
 * The desktop's egress proxy is configured from exactly this list, so an app
 * that was never granted cannot smuggle in a domain.
 */
export function originsForApps(
  apps: readonly CatalogApp[],
  appsOrigin: string = DEFAULT_APPS_ORIGIN,
): string[] {
  const origins = new Set<string>();
  for (const app of hostedApps(apps)) {
    const resolved = resolveLaunch(app.launch, appsOrigin);
    if (resolved.kind === 'web') origins.add(new URL(resolved.url).origin);
    for (const extra of app.extraOrigins ?? []) origins.add(new URL(extra).origin);
  }
  return [...origins].sort();
}

/** Peak RAM we should budget for a session allowed to run `apps`. */
export function memoryBudgetMib(apps: readonly CatalogApp[]): number {
  // A child runs one or two things at a time, not the whole catalogue. Budget
  // for the two heaviest plus the desktop shell rather than the naive sum.
  // Local activities contribute nothing: they never run on our hardware.
  const heaviest = [...hostedApps(apps)]
    .sort((a, b) => b.memoryHintMib - a.memoryHintMib)
    .slice(0, 2);
  const apps_ = heaviest.reduce((sum, a) => sum + a.memoryHintMib, 0);
  const SHELL_OVERHEAD_MIB = 420; // Xorg + window manager + VNC server
  return apps_ + SHELL_OVERHEAD_MIB;
}
