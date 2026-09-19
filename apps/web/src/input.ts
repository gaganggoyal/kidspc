import { useEffect } from 'react';

/**
 * What is actually driving this screen.
 *
 * A television can be operated by three quite different devices, and a
 * household is told they may pair a Bluetooth keyboard and mouse to theirs --
 * so all three are live possibilities on the same set, in the same evening:
 *
 *   - a D-pad remote, which has no cursor and needs a focus ring loud enough
 *     to find from a sofa;
 *   - a mouse, which has a cursor and for which that same ring is a rectangle
 *     stuck to whatever was last clicked;
 *   - a keyboard, which can do things a remote cannot -- type a password
 *     without an on-screen keypad, press a number to pick an answer.
 *
 * A media query cannot tell these apart. `pointer: none` is a claim the
 * browser makes about its default input device at page load, and a mouse
 * paired half an hour later never changes it. What does change is the events
 * that arrive, so that is what this watches.
 *
 * Two facts are published on the document element, and both are read from CSS:
 *
 *   data-input="key" | "pointer"
 *     The most recent thing the person touched. Flips both ways, because
 *     somebody with both a remote and a mouse uses whichever is nearer.
 *
 *   data-keyboard="yes"
 *     A real keyboard has been used at least once. Never unset: a keyboard
 *     that exists does not stop existing. It is what reveals the key hints on
 *     the answer buttons -- printing "1" on a button is help when there is a
 *     number row to press and clutter when there is not.
 */
export type InputMode = 'key' | 'pointer';

/**
 * The keys a television remote can produce. Anything outside this set is
 * evidence of a real keyboard: a remote has no letters, no digits, and no Tab.
 *
 * `Unidentified` is in here because several TV browsers report their own
 * buttons that way, and treating an unnamed key as proof of a keyboard would
 * light up the hints on exactly the devices that have none.
 */
const REMOTE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Backspace',
  'GoBack',
  'BrowserBack',
  'BrowserHome',
  'ContextMenu',
  'MediaPlayPause',
  'Unidentified',
]);

let mode: InputMode = 'key';

/**
 * Begins watching, once, before React renders.
 *
 * The default is `key` rather than `pointer` because getting it wrong in that
 * direction is survivable and the other way is not: a mouse user shown a
 * slightly loud focus ring for one frame has seen a focus ring, while a remote
 * user shown no ring at all has no idea where they are on the screen.
 */
export function startInputTracking(): void {
  const root = document.documentElement;
  root.dataset.input = mode;

  const set = (next: InputMode) => {
    if (next === mode) return;
    mode = next;
    root.dataset.input = next;
  };

  window.addEventListener(
    'keydown',
    (event) => {
      set('key');
      // A remote that emulates a mouse still sends arrows; a keyboard is the
      // only thing here that can send a letter.
      if (!REMOTE_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey) {
        root.dataset.keyboard = 'yes';
      }
    },
    // Capture, so this is recorded even for keys a handler stops.
    true,
  );

  window.addEventListener('pointerdown', () => set('pointer'), true);
  window.addEventListener('wheel', () => set('pointer'), { capture: true, passive: true });

  /*
   * Movement, not merely the existence of a move event.
   *
   * Browsers synthesise a `pointermove` at (0, 0) in situations that have
   * nothing to do with a hand -- a layout shift under a stationary cursor, a
   * focus change -- and treating those as "a mouse is in use" would quietly
   * turn the focus ring down on a television with no mouse attached to it.
   */
  let last: { x: number; y: number } | null = null;
  window.addEventListener(
    'pointermove',
    (event) => {
      if (last && Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y) > 3) {
        set('pointer');
      }
      last = { x: event.clientX, y: event.clientY };
    },
    { capture: true, passive: true },
  );
}

/**
 * Number keys pick an answer.
 *
 * Every multiple-choice activity here can be played with a D-pad, which means
 * four presses of an arrow and one of OK to reach the last option. With a
 * keyboard attached that is one press, and the mapping -- 1 for the first
 * button, 2 for the second -- is the one every quiz has used forever.
 *
 * `count` rather than the options themselves, because the caller knows what
 * an index means and this does not. Nothing happens for a digit past the end,
 * so a four-option question ignores 5 rather than throwing.
 */
export function useChoiceKeys(onPick: (index: number) => void, count: number, enabled = true): void {
  useEffect(() => {
    if (!enabled || count <= 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A child typing "3" into the writing pad is typing, not answering.
      const target = event.target as HTMLElement | null;
      if (target?.matches?.('input, textarea, select, [contenteditable]')) return;

      const index = '123456789'.indexOf(event.key);
      if (index === -1 || index >= count) return;
      event.preventDefault();
      onPick(index);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPick, count, enabled]);
}
