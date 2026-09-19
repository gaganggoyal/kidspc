/**
 * How big this device wants everything.
 *
 * Every media query that claims to detect a television is a guess, and this
 * one guessed wrong on a real set: `pointer: none` is the honest signal, but a
 * remote that emulates a mouse reports a pointer, and the browser is then
 * indistinguishable from a laptop. The stylesheet has admitted that in a
 * comment since the beginning. It turns out "degrades to slightly small" reads,
 * from a sofa, as unusable.
 *
 * So detection stays as the default and stops being the only answer. A person
 * who can see the screen is a better judge of how far away they are sitting
 * than any feature query, and their answer is remembered on that device --
 * which is the right scope, because the same household account is used from
 * the television and from a phone and wants different things on each.
 *
 * Deliberately not a server-side account setting for that reason, and because
 * a child should not have to be signed in for the text to be readable.
 */
export type ScreenMode = 'auto' | 'big';

const KEY = 'kidpc.screen';

export function getScreenMode(): ScreenMode {
  try {
    return window.localStorage.getItem(KEY) === 'big' ? 'big' : 'auto';
  } catch {
    // Private browsing, or storage turned off. Detection is still in play.
    return 'auto';
  }
}

/**
 * Written to the document element rather than held in React state, so it
 * applies to the very first paint and to every screen at once -- including the
 * ones rendered before any component of ours has mounted.
 */
export function applyScreenMode(mode: ScreenMode = getScreenMode()): void {
  document.documentElement.dataset.screen = mode;
}

export function setScreenMode(mode: ScreenMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Losing the preference on reload is worse than nothing, but not by
    // enough to refuse to apply it now.
  }
  applyScreenMode(mode);
}
