import type { ProgressMetric } from './ActivityShell';

/**
 * Progress metrics in words a nine-year-old and their grandmother both read.
 *
 * The stored names are machine names -- `words_per_minute`, `accuracy_pct` --
 * and they belong in the database, not on a certificate. One map, because these
 * appear on the child's screen, on the parent's dashboard and on the thing that
 * gets forwarded to the family group, and three spellings of "puzzles solved"
 * is how a product starts to feel unmade.
 */
export const METRIC_LABEL: Record<ProgressMetric, string> = {
  score: 'Best score',
  level: 'Reached level',
  accuracy_pct: 'Accuracy',
  words_per_minute: 'Typing speed',
  words_written: 'Words written',
  puzzles_solved: 'Puzzles solved',
  minutes_practised: 'Minutes practised',
};

/** The unit, if there is one. Kept apart so the number can be styled alone. */
export const METRIC_UNIT: Partial<Record<ProgressMetric, string>> = {
  accuracy_pct: '%',
  words_per_minute: ' wpm',
  minutes_practised: ' min',
};

export function formatMetric(metric: ProgressMetric, value: number): string {
  return `${Math.round(value)}${METRIC_UNIT[metric] ?? ''}`;
}

/**
 * The one number a tile shows, when an activity keeps several.
 *
 * Earlier in this list wins: a score is what a child would name if asked
 * "what's your best?", and a minutes-practised total is the least of it.
 */
const HEADLINE: readonly ProgressMetric[] = [
  'score',
  'level',
  'puzzles_solved',
  'words_per_minute',
  'words_written',
  'accuracy_pct',
  'minutes_practised',
];

export interface Headline {
  metric: ProgressMetric;
  best: number;
}

export function headlineBests(
  rows: ReadonlyArray<{ appId: string; metric: string; best: number }>,
): Record<string, Headline> {
  const out: Record<string, Headline> = {};
  for (const row of rows) {
    const rank = HEADLINE.indexOf(row.metric as ProgressMetric);
    if (rank < 0 || row.best <= 0) continue;
    const current = out[row.appId];
    if (!current || rank < HEADLINE.indexOf(current.metric)) {
      out[row.appId] = { metric: row.metric as ProgressMetric, best: row.best };
    }
  }
  return out;
}
