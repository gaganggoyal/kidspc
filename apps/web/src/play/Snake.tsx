import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { type Dir, Hud, Result, TouchPad, useArrowKeys, useSwipe } from './kit';
import { newSnake, type SnakeState, step, tickMs, turn } from './rules/snake';

/**
 * Snake.
 *
 * The oldest game on any screen, and a better fit for a television remote than
 * almost anything written since: four arrows are the entire controller. What
 * it asks of a child is to plan a few moves ahead of where they are, and to
 * keep doing so while the thing they are steering gets longer.
 *
 * Two modes, because walls that end the round are the whole difficulty for a
 * five-year-old. In the gentle one the snake leaves one side and comes back on
 * the other, and the only way to lose is to bite your own tail.
 *
 * Drawn on a canvas rather than as 225 elements: a board that redraws eight
 * times a second is exactly what a television's processor is worst at when it
 * goes through React and a stylesheet.
 */
const SIZE = 15;
const PX = 720;
const CELL = PX / SIZE;

type Mode = 'gentle' | 'classic';
type Phase = 'ready' | 'playing' | 'paused' | 'over';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  // `ctx.roundRect` arrived in Chrome 99; the televisions this runs on are older.
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(canvas: HTMLCanvasElement | null, game: SnakeState) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#13203d' : '#172647';
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }

  if (game.food) {
    ctx.font = `${CELL * 0.82}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍎', game.food.x * CELL + CELL / 2, game.food.y * CELL + CELL / 2 + 2);
  }

  const n = game.body.length;
  game.body.forEach((p, i) => {
    // Bright at the head, deeper towards the tail, so which end is which is
    // never a question even when the snake is coiled.
    const light = 62 - (i / Math.max(1, n - 1)) * 22;
    ctx.fillStyle = game.alive ? `hsl(142 70% ${light}%)` : `hsl(0 0% ${light}%)`;
    const inset = i === 0 ? 2 : 4;
    roundRect(
      ctx,
      p.x * CELL + inset,
      p.y * CELL + inset,
      CELL - inset * 2,
      CELL - inset * 2,
      CELL * 0.3,
    );
    ctx.fill();
  });

  // Eyes, looking where the snake is going.
  const head = game.body[0]!;
  const look = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[game.dir];
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const side = [look[1]!, -look[0]!];
  for (const s of [1, -1]) {
    const ex = cx + look[0]! * CELL * 0.12 + side[0]! * s * CELL * 0.2;
    const ey = cy + look[1]! * CELL * 0.12 + side[1]! * s * CELL * 0.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, CELL * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(ex + look[0]! * CELL * 0.05, ey + look[1]! * CELL * 0.05, CELL * 0.065, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function SnakeGame({ activity }: { activity: ActivityApi }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('gentle');
  const game = useRef<SnakeState>(newSnake(SIZE, true));
  const [phase, setPhase] = useState<Phase>('ready');
  const [eaten, setEaten] = useState(0);
  // A ref as well as state: the tick that ends the round has to compare with
  // the best as it stood, not as a closure captured it three apples ago.
  const bestRef = useRef(activity.best('score') ?? 0);
  const [best, setBest] = useState(bestRef.current);
  const [record, setRecord] = useState(false);

  const start = useCallback((as: Mode) => {
    setMode(as);
    game.current = newSnake(SIZE, as === 'gentle');
    setEaten(0);
    setPhase('playing');
  }, []);

  // A frame on every phase change, so the board is never blank behind a menu;
  // and focus back on the board when play resumes, because the button that
  // resumed it has just been removed and focus would otherwise fall to nothing.
  useEffect(() => {
    draw(canvas.current, game.current);
    if (phase === 'playing') board.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = setInterval(
      () => {
        const { state, ate } = step(game.current);
        game.current = state;
        draw(canvas.current, state);
        if (ate) {
          sfx.good();
          setEaten(state.eaten);
        }
        if (!state.alive) {
          clearInterval(timer);
          if (state.food === null) sfx.win();
          else sfx.over();
          activity.report('score', state.eaten);
          const beaten = state.eaten > bestRef.current;
          if (beaten) bestRef.current = state.eaten;
          setRecord(beaten);
          setBest(bestRef.current);
          setPhase('over');
        }
      },
      tickMs(eaten, mode === 'classic'),
    );
    return () => clearInterval(timer);
  }, [phase, eaten, mode, activity]);

  const steer = useCallback((dir: Dir) => {
    game.current = turn(game.current, dir);
  }, []);

  useArrowKeys({ onDir: steer, onOk: () => setPhase('paused') }, phase === 'playing');
  useSwipe(board, steer, phase === 'playing');

  return (
    <div className="arcade">
      <Hud
        items={[
          ['apples', eaten],
          ['best', Math.max(best, eaten)],
          ['', mode === 'gentle' ? '🐢 Gentle' : '🐇 Classic'],
        ]}
      />

      <div className="board-wrap">
        <div ref={board} className="game-board snake-board" tabIndex={-1} aria-label="Snake board">
          <canvas ref={canvas} width={PX} height={PX} className="game-canvas" />
        </div>

        {phase !== 'playing' && (
          <div className="board-overlay">
            {phase === 'ready' && (
              <Result
                glyph="🍎"
                title="Snake"
                detail="Eat the apples and grow longer. Don’t bite your own tail!"
              >
                <button className="primary" autoFocus onClick={() => start('gentle')}>
                  🐢 Gentle
                </button>
                <button onClick={() => start('classic')}>🐇 Classic</button>
              </Result>
            )}
            {phase === 'paused' && (
              <Result glyph="⏸️" title="Paused">
                <button className="primary" autoFocus onClick={() => setPhase('playing')}>
                  Carry on
                </button>
                <button onClick={() => start(mode)}>Start again</button>
              </Result>
            )}
            {phase === 'over' && (
              <Result
                glyph={game.current.food === null ? '🏆' : record ? '🌟' : '🐍'}
                title={
                  game.current.food === null
                    ? 'You filled the whole board!'
                    : record
                      ? 'New best!'
                      : 'Ouch!'
                }
                detail={`${eaten} ${eaten === 1 ? 'apple' : 'apples'} this time.`}
              >
                <button className="primary" autoFocus onClick={() => start(mode)}>
                  Play again
                </button>
                <button onClick={() => start(mode === 'gentle' ? 'classic' : 'gentle')}>
                  {mode === 'gentle' ? '🐇 Try Classic' : '🐢 Try Gentle'}
                </button>
              </Result>
            )}
          </div>
        )}
      </div>

      {phase === 'playing' && (
        <TouchPad onDir={steer} onOk={() => setPhase('paused')} okLabel="⏸" />
      )}
      <p className="play-hint">
        <span className="hint-remote">Arrows to steer · OK to pause</span>
        <span className="hint-touch">Swipe or use the arrows to steer</span>
      </p>
    </div>
  );
}
