import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { type Dir, Hud, Result, useArrowKeys } from './kit';

/**
 * Colour Echo.
 *
 * Watch a sequence of lights, play it back, and it grows by one. It is the
 * working-memory game that has sat in toy shops since the seventies, and it
 * turns out to have been designed for a television remote: four pads, laid out
 * as a cross, so each one *is* an arrow. Up is green, right is red, down is
 * yellow, left is blue, and a child learns that in one round without being told.
 *
 * Every pad has its own note, and the four make a major chord, so a sequence is
 * also a tune -- which is how most people actually remember one.
 */
const PADS: Array<{ dir: Dir; colour: string; name: string; hz: number; arrow: string }> = [
  { dir: 'up', colour: 'green', name: 'Green', hz: 392.0, arrow: '▲' },
  { dir: 'right', colour: 'red', name: 'Red', hz: 329.63, arrow: '▶' },
  { dir: 'down', colour: 'yellow', name: 'Yellow', hz: 261.63, arrow: '▼' },
  { dir: 'left', colour: 'blue', name: 'Blue', hz: 196.0, arrow: '◀' },
];

type Phase = 'ready' | 'showing' | 'input' | 'over';

const randomDir = (): Dir => PADS[Math.floor(Math.random() * 4)]!.dir;

export function EchoGame({ activity }: { activity: ActivityApi }) {
  const [sequence, setSequence] = useState<Dir[]>([]);
  const [phase, setPhase] = useState<Phase>('ready');
  const [lit, setLit] = useState<Dir | null>(null);
  const [position, setPosition] = useState(0);
  const bestRef = useRef(activity.best('level') ?? 0);
  const [best, setBest] = useState(bestRef.current);
  const [record, setRecord] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((dir: Dir, ms: number) => {
    const pad = PADS.find((p) => p.dir === dir)!;
    sfx.note(pad.hz, ms / 1000);
    setLit(dir);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setLit(null), ms);
  }, []);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // Play the sequence back. A little quicker as it grows, so a long run is a
  // test of memory rather than of patience.
  useEffect(() => {
    if (phase !== 'showing') return;
    const on = Math.max(260, 560 - sequence.length * 22);
    const gap = Math.round(on * 0.45);
    const timers = sequence.map((dir, i) => setTimeout(() => flash(dir, on), 700 + i * (on + gap)));
    timers.push(
      setTimeout(
        () => {
          setPosition(0);
          setPhase('input');
        },
        700 + sequence.length * (on + gap),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, sequence, flash]);

  const start = () => {
    setSequence([randomDir()]);
    setPosition(0);
    setPhase('showing');
  };

  const press = useCallback(
    (dir: Dir) => {
      if (phase !== 'input') return;
      flash(dir, 240);
      if (dir !== sequence[position]) {
        const reached = sequence.length - 1;
        setTimeout(() => sfx.miss(), 120);
        setRecord(reached > bestRef.current);
        if (reached > bestRef.current) bestRef.current = reached;
        setBest(bestRef.current);
        if (reached > 0) activity.report('level', reached);
        setPhase('over');
        return;
      }
      if (position + 1 === sequence.length) {
        setPhase('showing');
        setSequence((s) => [...s, randomDir()]);
        if (sequence.length % 5 === 0) setTimeout(() => sfx.win(), 300);
      } else {
        setPosition(position + 1);
      }
    },
    [phase, sequence, position, flash, activity],
  );

  // The arrows are the pads for the whole round, including while the sequence
  // plays -- otherwise a child pressing along with it would move focus around
  // the screen and end up somewhere they did not mean to be.
  useArrowKeys({ onDir: press }, phase === 'showing' || phase === 'input');

  const score = Math.max(0, sequence.length - 1);

  return (
    <div className="arcade">
      <Hud
        items={[
          ['in a row', phase === 'ready' ? 0 : score],
          ['best', best],
        ]}
      />

      <div className="board-wrap">
        <div className={`echo-pad-grid ${phase}`} role="group" aria-label="Colour pads">
          {PADS.map((pad) => (
            <button
              key={pad.dir}
              type="button"
              tabIndex={-1}
              className={`echo-pad ${pad.colour} pad-${pad.dir} ${lit === pad.dir ? 'lit' : ''}`}
              aria-label={`${pad.name}, arrow ${pad.dir}`}
              onPointerDown={(event) => {
                event.preventDefault();
                press(pad.dir);
              }}
            >
              <span aria-hidden="true">{pad.arrow}</span>
            </button>
          ))}
          <div className="echo-hub" aria-live="polite">
            {phase === 'showing' ? 'Watch…' : phase === 'input' ? 'Your turn!' : ''}
          </div>
        </div>

        {(phase === 'ready' || phase === 'over') && (
          <div className="board-overlay">
            {phase === 'ready' ? (
              <Result
                glyph="🌈"
                title="Colour Echo"
                detail="Watch the colours light up, then play them back with the arrows."
              >
                <button className="primary" autoFocus onClick={start}>
                  Start
                </button>
              </Result>
            ) : (
              <Result
                glyph={record ? '🌟' : '🌈'}
                title={record ? 'Your best yet!' : 'Oops — wrong colour'}
                detail={`You remembered ${score} in a row.`}
              >
                <button className="primary" autoFocus onClick={start}>
                  Play again
                </button>
              </Result>
            )}
          </div>
        )}
      </div>

      <p className="play-hint">
        <span className="hint-remote">Each arrow is a colour: ▲ green ▶ red ▼ yellow ◀ blue</span>
        <span className="hint-touch">Tap the colours in the same order</span>
      </p>
    </div>
  );
}
