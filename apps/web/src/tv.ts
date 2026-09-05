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
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useSpatialNavigation(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
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

/** Move focus to the first focusable element once a screen has rendered. */
export function useAutoFocusFirst(deps: unknown[] = []): void {
  useEffect(() => {
    const first = document.querySelector<HTMLElement>(FOCUSABLE);
    // Only claim focus if nothing already has it, so we never yank the cursor
    // out from under someone mid-interaction.
    if (first && (!document.activeElement || document.activeElement === document.body)) {
      first.focus();
    }
    // The dependency list is the caller's to choose: this hook runs when a
    // *screen* changes, which is not something a dep-array linter can infer.
  }, deps);
}
