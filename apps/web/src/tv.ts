import { useEffect } from 'react';

/**
 * D-pad navigation.
 *
 * An Android TV remote sends plain arrow keys and Enter, so the browser's own
 * focus model gets us most of the way -- but only Tab order, which runs in DOM
 * order and ignores the fact that a grid has rows. This maps arrow keys onto
 * geometry: from the focused element, move to whichever focusable element is
 * nearest in the direction pressed.
 *
 * Deliberately not a library. The whole behaviour is forty lines, and every TV
 * navigation package brings a focus manager that fights React's own.
 */
/*
 * `tabindex="-1"` is excluded from buttons too, not only from the generic
 * `[tabindex]` clause. The games draw an on-screen D-pad for phones, and those
 * arrows are for a thumb: a remote landing on "↑" and pressing OK would steer
 * the snake with the button meant to replace the remote.
 */
const FOCUSABLE =
  'button:not(:disabled):not([tabindex="-1"]), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The first control a remote should land on: the first rendered one inside
 * the screen's `[data-focus-root]`, or in the page when the root has none --
 * a profile picker whose every child still awaits approval has a root full of
 * disabled buttons, and a remote with nowhere to go is a remote that is broken.
 *
 * The page means `document.body`, never `document`. The selector includes
 * `[href]`, and the first `[href]` in a document is a `<link>` in its head --
 * the icon, the manifest. Focusing one of those does nothing, so every screen
 * without a focus root (the profile picker, the PIN pad, the launcher) used to
 * open with nothing focused, and a remote's first press had nowhere to start.
 */
function firstControl(): HTMLElement | undefined {
  const visible = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => el.offsetParent !== null);
  const root = document.querySelector('[data-focus-root]');
  return (root && visible(root)) || visible(document.body);
}

export function useSpatialNavigation(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * Somebody closer to the key has already used it.
       *
       * The arrow games -- Snake, 2048, the maze -- listen in the capture
       * phase and claim the arrows while a round is being played. Without this
       * the same press steered the snake and then moved focus off the board
       * onto the Back button, and the next OK left the game.
       */
      if (event.defaultPrevented) return;
      const direction = (
        {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        } as const
      )[event.key];
      if (!direction) return;

      const active = document.activeElement as HTMLElement | null;
      // Inside a text field, arrows move the caret. Never steal those.
      if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

      /*
       * Nothing focused yet: the first press lands on the first control, not
       * on whatever happens to lie in that direction from the middle of the
       * page -- which is where the body's own rectangle put the origin, and
       * how the first press on the arcade used to land on a tile halfway down.
       */
      if (!active || active === document.body) {
        const first = firstControl();
        if (first) {
          event.preventDefault();
          first.focus();
          first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        return;
      }

      const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el !== active && el.offsetParent !== null,
      );
      if (candidates.length === 0) return;

      const origin = active?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
      const originX = origin.left + origin.width / 2;
      const originY = origin.top + origin.height / 2;

      let best: { el: HTMLElement; score: number } | null = null;
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - originX;
        const dy = rect.top + rect.height / 2 - originY;

        const forward = { up: -dy, down: dy, left: -dx, right: dx }[direction];
        if (forward <= 1) continue; // not in the direction pressed

        // Distance along the axis of travel, plus a heavy penalty for drifting
        // sideways. Without the penalty, a diagonal neighbour often wins over
        // the obvious one directly below.
        const lateral = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
        /*
         * And nothing far off to the side at all. "Right" from the last tile in
         * a row used to find the only thing further right on the whole screen
         * -- the "Not me" button at the top -- so a child pressing right along
         * the games and then OK was signed out of their own profile. Past the
         * end of a row, right now does nothing, as it does on every television.
         */
        if (lateral > forward * 3) continue;
        const score = forward + lateral * 3;
        if (!best || score < best.score) best = { el, score };
      }

      if (best) {
        event.preventDefault();
        best.el.focus();
        best.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Move focus to the first focusable element once a screen has rendered.
 *
 * "First" means first inside `[data-focus-root]` when a screen declares one,
 * and first in the document otherwise. That distinction is the whole reason
 * this comment exists: every activity puts a "← Back" button in its bar before
 * the game in the markup, so searching the document landed a child on Back
 * every single time they opened an activity. With no cursor on a television
 * and -- on the older browsers -- no visible focus ring either, the first press
 * of OK took them straight back out of the thing they had just opened.
 */
export function useAutoFocusFirst(deps: unknown[] = []): void {
  useEffect(() => {
    const first = firstControl();
    // Only claim focus if nothing already has it, so we never yank the cursor
    // out from under someone mid-interaction.
    if (first && (!document.activeElement || document.activeElement === document.body)) {
      first.focus();
    }
    // The dependency list is the caller's to choose: this hook runs when a
    // *screen* changes, which is not something a dep-array linter can infer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Leaving an activity, however the device says "back".
 *
 * A television remote's back button does not arrive as one key. Android TV
 * browsers send `GoBack`, some send `BrowserBack`, a keyboard sends Escape, and
 * a plain browser sends Backspace -- which is also a character a child is
 * typing, so it only counts outside a text field.
 *
 * That list lives here rather than in each shell because it is a fact about
 * devices, not about any one screen, and the copy of it that had already drifted
 * into the preview shell was one bug away from the two disagreeing about what
 * "back" means.
 *
 * `enabled` is for screens that stack: when something is open on top, Escape
 * belongs to whatever is on top, and closing two things with one press is how a
 * child ends up back at the launcher without meaning to.
 */
export function useBackKey(onBack: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const inTextField = (event.target as HTMLElement | null)?.matches?.(
        'input, textarea, [contenteditable]',
      );
      const isBack =
        event.key === 'Escape' ||
        event.key === 'GoBack' ||
        event.key === 'BrowserBack' ||
        (event.key === 'Backspace' && !inTextField);
      if (!isBack) return;
      event.preventDefault();
      onBack();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack, enabled]);
}
