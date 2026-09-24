import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, type Dir, Hud, Result, useArrowKeys, useSwipe } from './kit';
import { type Board, canMove, move, newBoard, spawn } from './rules/merge';

/**
 * 2048.
 *
 * Doubling, over and over, until a child can tell at a glance that two 64s
 * make a 128 -- and a planning game underneath that, because the tiles only
 * merge in the direction you chose and every move brings in a new one you did
 * not. It is offered from nine: younger children can move the tiles, but the
 * part that makes it a game is keeping the big numbers in a corner, and that
 * needs a plan held over dozens of moves.
 */
const SIZE = 4;

type Phase = 'playing' | 'menu' | 'won' | 'over';

interface Flash {
  spawned: number;
  merged: number[];
  /** Bumps on every move, so a tile that pops twice in a row pops twice. */
  stamp: number;
}

export function MergeGame({ activity }: { activity: ActivityApi }) {
  const board = useRef<HTMLDivElement>(null);
  const [tiles, setTiles] = useState<Board>(() => newBoard(SIZE));
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const [flash, setFlash] = useState<Flash>({ spawned: -1, merged: [], stamp: 0 });
  const [keepGoing, setKeepGoing] = useState(false);
  const [burst, setBurst] = useState(0);
  const [best, setBest] = useState(() => activity.best('score') ?? 0);

  // Reported when a round ends and, failing that, when the child leaves
  // mid-game -- a score of 3,000 abandoned for dinner still counts.
  const scoreRef = useRef(0);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);
  useEffect(
    () => () => {
      if (scoreRef.current > 0) activity.report('score', scoreRef.current);
    },
    [activity],
  );

  useEffect(() => {
    if (phase === 'playing') board.current?.focus();
  }, [phase]);

  const restart = useCallback(() => {
    if (scoreRef.current > 0) activity.report('score', scoreRef.current);
    setTiles(newBoard(SIZE));
    setScore(0);
    setKeepGoing(false);
    setFlash({ spawned: -1, merged: [], stamp: 0 });
    setPhase('playing');
  }, [activity]);

  const slide = useCallback(
    (dir: Dir) => {
      const result = move(tiles, SIZE, dir);
      if (!result.moved) {
        sfx.bounce();
        return;
      }
      const placed = spawn(result.board);
      const nextScore = score + result.gained;
      setTiles(placed.board);
      setScore(nextScore);
      setBest((b) => Math.max(b, nextScore));
      setFlash((f) => ({ spawned: placed.at, merged: result.merged, stamp: f.stamp + 1 }));
      if (result.merged.length) sfx.good();
      else sfx.move();

      if (!keepGoing && placed.board.some((v) => v >= 2048)) {
        sfx.win();
        setBurst((n) => n + 1);
        activity.report('score', nextScore);
        setPhase('won');
      } else if (!canMove(placed.board, SIZE)) {
        sfx.over();
        activity.report('score', nextScore);
        setPhase('over');
      }
    },
    [tiles, score, keepGoing, activity],
  );

  useArrowKeys({ onDir: slide, onOk: () => setPhase('menu') }, phase === 'playing');
  useSwipe(board, slide, phase === 'playing');

  const biggest = Math.max(...tiles);

  return (
    <div className="arcade">
      <Hud
        items={[
          ['score', score],
          ['best', Math.max(best, score)],
          ['biggest tile', biggest],
        ]}
      />

      <div className="board-wrap">
        <div ref={board} className="game-board merge-board" tabIndex={-1} aria-label="2048 board">
          {tiles.map((value, i) => {
            const popped = i === flash.spawned ? 'new' : flash.merged.includes(i) ? 'merged' : '';
            return (
              <div className="merge-cell" key={i}>
                {value > 0 && (
                  <span
                    // A fresh key restarts the pop animation on a tile that has
                    // just changed; an unchanged tile keeps its node and sits still.
                    key={popped ? `${flash.stamp}` : 'still'}
                    className={`merge-tile v${Math.min(value, 4096)} ${popped}`}
                  >
                    {value}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {phase !== 'playing' && (
          <div className="board-overlay">
            {phase === 'menu' && (
              <Result glyph="⏸️" title="Paused">
                <button className="primary" autoFocus onClick={() => setPhase('playing')}>
                  Carry on
                </button>
                <button onClick={restart}>New game</button>
              </Result>
            )}
            {phase === 'won' && (
              <Result
                glyph="🏆"
                title="You made 2048!"
                detail={`${score} points. Can you go further?`}
              >
                <button
                  className="primary"
                  autoFocus
                  onClick={() => {
                    setKeepGoing(true);
                    setPhase('playing');
                  }}
                >
                  Keep going
                </button>
                <button onClick={restart}>New game</button>
              </Result>
            )}
            {phase === 'over' && (
              <Result
                glyph={biggest >= 512 ? '🌟' : '🔶'}
                title="No more moves"
                detail={`You reached ${biggest} and scored ${score}.`}
              >
                <button className="primary" autoFocus onClick={restart}>
                  Play again
                </button>
              </Result>
            )}
          </div>
        )}
      </div>

      <button type="button" tabIndex={-1} className="pointer-only" onClick={() => setPhase('menu')}>
        ⏸ Menu
      </button>
      <p className="play-hint">
        <span className="hint-remote">Arrows slide every tile · OK for the menu</span>
        <span className="hint-touch">Swipe to slide every tile</span>
      </p>
      <Confetti burst={burst} />
    </div>
  );
}
