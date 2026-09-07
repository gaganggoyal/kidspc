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
