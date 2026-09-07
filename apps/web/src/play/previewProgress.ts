import { findApp } from '@kidpc/shared';
import { type ProgressMetric } from './ActivityShell';
import { formatMetric, METRIC_LABEL } from './metrics';

/**
 * Personal bests in the public preview.
 *
 * A child playing on the marketing site has no account, and giving them one to
 * hold a score would be exactly the wrong trade: an account for a child needs a
 * verified parent behind it, and a high score is not worth asking a family to
 * prove anything. So the bests live in localStorage on the device that earned
 * them, and go no further.
 *
 * That is also, quietly, the sales argument. These scores are lost when the
 * browser is cleared, they do not follow a child from the tablet to the TV, and
 * two siblings sharing a laptop overwrite each other. Every one of those is
 * fixed by a household account, and a parent works that out faster by running
 * into it than by reading it on a pricing page.
 */
const KEY = 'kidpc.preview.bests';

type Bests = Record<string, number>;

function read(): Bests {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    // Anything that is not a finite number was not written by us.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v),
      ),
    ) as Bests;
  } catch {
    return {};
  }
}

function write(bests: Bests): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(bests));
  } catch {
    // A full or blocked store costs a score, never a game.
  }
}

const cell = (appId: string, metric: ProgressMetric) => `${appId}:${metric}`;

export function previewBest(appId: string, metric: ProgressMetric): number | null {
  return read()[cell(appId, metric)] ?? null;
}

/** Keeps the higher of the two. Every metric here is one where more is better. */
export function recordPreviewBest(appId: string, metric: ProgressMetric, value: number): void {
  const bests = read();
  const key = cell(appId, metric);
  const previous = bests[key];
  if (previous !== undefined && previous >= value) return;
  bests[key] = Math.round(value * 100) / 100;
  write(bests);
}

/** Everything worth putting on a card, newest activity first is not knowable -- so catalogue order. */
export function previewAchievements(): Array<{ label: string; value: string }> {
  const bests = read();
  return Object.entries(bests)
    .flatMap(([key, value]) => {
      const [appId, metric] = key.split(':') as [string, ProgressMetric];
      const app = findApp(appId);
      const label = METRIC_LABEL[metric];
      // A metric or an app we have since removed: drop it rather than print a
      // machine name onto something a parent is about to forward.
      if (!app || !label) return [];
      return [{ label: `${app.name} — ${label}`, value: formatMetric(metric, value) }];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function hasPreviewProgress(): boolean {
  return Object.keys(read()).length > 0;
}
