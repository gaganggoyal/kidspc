/**
 * Shuffling, once.
 *
 * `sort(() => Math.random() - 0.5)` is the wrong way to do this and was in here
 * once already: a sort comparator has to be consistent, that one is not, and
 * what an engine does with an inconsistent comparator is neither specified nor
 * uniform. On four choices it put the right answer under the first button
 * nearly half again as often as under the third.
 *
 * It lives here rather than in any one activity because five of them now shuffle
 * something, and five copies of a subtle thing is five chances to get it wrong
 * again. Every quiz in this product draws its choices through this function.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** One item, uniformly. */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/**
 * One item that is not the one you just had.
 *
 * Every activity here asks a question, then asks another. Drawing independently
 * means the same prompt lands twice in a row often enough for a child to notice
 * and say the game is broken, which is a fair reading of what it looks like.
 */
export function pickOther<T>(items: readonly T[], previous: T | null): T {
  if (items.length < 2 || previous === null) return pick(items);
  let next = pick(items);
  while (next === previous) next = pick(items);
  return next;
}
