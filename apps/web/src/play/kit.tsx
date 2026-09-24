import { type MutableRefObject, type RefObject, useEffect, useRef } from 'react';
import { useSound } from '../sfx';

/**
 * The parts every arcade game here shares.
 *
 * The quiz activities are made of buttons, and spatial navigation already
 * moves a remote between buttons. The arcade games are different: in Snake an
 * arrow is not "go to the next control", it is the game. So these games claim
 * the arrows for as long as a round is being played and hand them back the
 * moment it stops -- which is when the buttons (Play again, a harder board)
 * appear and need the remote again.
 */
export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // A keyboard plugged into the television gets the layout every PC game uses.
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  W: 'up',
  A: 'left',
  S: 'down',
  D: 'right',
};

/** Keeps the newest callback without re-subscribing a listener every render. */
function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Arrows, and OK, belong to the game while `enabled`.
 *
 * Capture phase and `preventDefault`, because spatial navigation listens on the
 * same window in the bubble phase and steps aside for a key somebody has
 * already used. The Back key is deliberately left alone: whatever the game is
 * doing, the remote's Back button still leaves it.
 *
 * `repeat` is whether a held key keeps firing. It is wanted in the maze, where
 * holding right means "run along this corridor", and unwanted in 2048, where a
 * held arrow would make eight moves nobody chose.
 */
export function useArrowKeys(
  handlers: { onDir?: (dir: Dir) => void; onOk?: () => void },
  enabled: boolean,
  { repeat = false }: { repeat?: boolean } = {},
): void {
  const latest = useLatest(handlers);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches?.('input, textarea, select, [contenteditable]')) return;

      const dir = DIRS[event.key];
      if (dir && latest.current.onDir) {
        event.preventDefault();
        if (!event.repeat || repeat) latest.current.onDir(dir);
        return;
      }
      if ((event.key === 'Enter' || event.key === ' ') && latest.current.onOk) {
        event.preventDefault();
        if (!event.repeat) latest.current.onOk();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, repeat, latest]);
}

/**
 * A swipe on the board, for a phone.
 *
 * The board carries `touch-action: none` in the stylesheet, or the browser
 * would read the same gesture as a scroll and the page would move instead of
 * the snake.
 */
export function useSwipe(
  target: RefObject<HTMLElement | null>,
  onDir: (dir: Dir) => void,
  enabled: boolean,
): void {
  const latest = useLatest(onDir);

  useEffect(() => {
    const el = target.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      start = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      latest.current(
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
      );
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
    };
  }, [target, enabled, latest]);
}

/**
 * Arrows under a thumb.
 *
 * Shown only on a touch screen, by the stylesheet. On a television the remote
 * is the pad, and on a laptop the keyboard is; a second set drawn on screen
 * would be one more thing to look at and nothing to press.
 *
 * `tabIndex={-1}` keeps them out of spatial navigation, and they act on
 * pointer-down: a direction that waits for the finger to lift is a snake that
 * turns a beat late.
 */
export function TouchPad({
  onDir,
  onOk,
  okLabel = 'OK',
}: {
  onDir: (dir: Dir) => void;
  onOk?: () => void;
  okLabel?: string;
}) {
  const press = (dir: Dir) => (event: React.PointerEvent) => {
    event.preventDefault();
    onDir(dir);
  };
  const pad = (dir: Dir, glyph: string, label: string) => (
    <button
      type="button"
      tabIndex={-1}
      className={`pad-${dir}`}
      aria-label={label}
      onPointerDown={press(dir)}
    >
      {glyph}
    </button>
  );
  return (
    <div className="touch-pad no-print">
      {pad('up', '▲', 'Up')}
      {pad('left', '◀', 'Left')}
      {onOk ? (
        <button
          type="button"
          tabIndex={-1}
          className="pad-ok"
          onPointerDown={(event) => {
            event.preventDefault();
            onOk();
          }}
        >
          {okLabel}
        </button>
      ) : (
        <span className="pad-ok" />
      )}
      {pad('right', '▶', 'Right')}
      {pad('down', '▼', 'Down')}
    </div>
  );
}

/**
 * Confetti, for a round won.
 *
 * Forty CSS pieces rather than a canvas and a physics loop: it has to cost
 * nothing on a television whose processor is busy decoding a picture. Hidden
 * outright under reduced motion. `burst` is a counter -- each new value is a
 * new shower, because a changed key is how React restarts an animation.
 */
const PIECES = Array.from({ length: 40 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 40) / 100,
  spin: (i * 71) % 360,
  hue: (i * 47) % 360,
  drift: ((i * 29) % 60) - 30,
}));

export function Confetti({ burst }: { burst: number }) {
  if (burst === 0) return null;
  return (
    <div className="confetti" key={burst} aria-hidden="true">
      {PIECES.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}s`,
              background: `hsl(${p.hue} 90% 60%)`,
              '--spin': `${p.spin}deg`,
              '--drift': `${p.drift}vw`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** The numbers above a game: score, best, level. Big, and read at a glance. */
export function Hud({
  items,
}: {
  items: Array<[label: string, value: string | number] | false | null>;
}) {
  return (
    <div className="hud" aria-live="polite">
      {items.map((item) =>
        item ? (
          <span key={item[0]}>
            <b>{item[1]}</b>
            {item[0]}
          </span>
        ) : null,
      )}
    </div>
  );
}

/**
 * The end of a round, and the way into the next one.
 *
 * `autoFocus` on the first action, so OK on the remote -- the only thing a
 * child is likely to press next -- plays again rather than doing nothing.
 */
export function Result({
  glyph,
  title,
  detail,
  children,
}: {
  glyph: string;
  title: string;
  detail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="result" role="status">
      <span className="result-glyph" aria-hidden="true">
        {glyph}
      </span>
      <h2>{title}</h2>
      {detail && <p className="muted">{detail}</p>}
      <div className="row result-actions">{children}</div>
    </div>
  );
}

/** The one switch for every game's sounds. */
export function SoundToggle() {
  const [on, toggle] = useSound();
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Sounds on' : 'Sounds off'}
      title={on ? 'Sounds on' : 'Sounds off'}
    >
      <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
    </button>
  );
}
