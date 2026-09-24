import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, type Dir, Hud, Result, useArrowKeys, useSwipe } from './kit';
import { isSolved, scramble, slideAt, slideDir, type Tiles } from './rules/slide';

/**
 * Slide Puzzle.
 *
 * Spatial reasoning with the numbers doing double duty: a child reads 1 to 8
 * in order to know what "solved" looks like, then has to work out which tile
 * has to get out of the way first. Tiles already in their place are tinted,
 * so progress is visible from the sofa and a child who has the top row done can
 * see that they have.
 *
 * Every tile is positioned with a transform rather than by grid order, which is
 * what lets it slide: the same element moves to its new place, and the
 * transition animates the move instead of the tile vanishing and reappearing.
 */
type Phase = 'playing' | 'menu' | 'solved';

export function SlideGame({ activity }: { activity: ActivityApi }) {
  const board = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(3);
  const [tiles, setTiles] = useState<Tiles>(() => scramble(3));
  const [moves, setMoves] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const [solved, setSolved] = useState(0);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    if (phase === 'playing') board.current?.focus();
  }, [phase]);

  const deal = useCallback((nextSize: number) => {
    setSize(nextSize);
    setTiles(scramble(nextSize));
    setMoves(0);
    setPhase('playing');
  }, []);

  const land = useCallback(
    (next: Tiles | null) => {
      if (!next) {
        sfx.bounce();
        return;
      }
      sfx.move();
      setTiles(next);
      setMoves((m) => m + 1);
      if (isSolved(next)) {
        sfx.win();
        setBurst((n) => n + 1);
        const count = solved + 1;
        setSolved(count);
        activity.report('puzzles_solved', count);
        setPhase('solved');
      }
    },
    [solved, activity],
  );

  const onDir = useCallback((dir: Dir) => land(slideDir(tiles, size, dir)), [land, tiles, size]);
  useArrowKeys({ onDir, onOk: () => setPhase('menu') }, phase === 'playing');
  useSwipe(board, onDir, phase === 'playing');

  const best = activity.best('puzzles_solved');

  return (
    <div className="arcade">
      <Hud
        items={[
          ['moves', moves],
          ['solved', solved],
          best !== null && best > solved ? ['best', best] : null,
        ]}
      />

      <div className="board-wrap">
        <div
          ref={board}
          className="game-board slide-board"
          tabIndex={-1}
          aria-label={`Sliding puzzle, ${size} by ${size}`}
          style={{ '--n': size } as React.CSSProperties}
        >
          {tiles.map((value, index) =>
            value === 0 ? null : (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                className={`slide-tile ${value === index + 1 ? 'home' : ''}`}
                style={
                  {
                    '--x': index % size,
                    '--y': Math.floor(index / size),
                  } as React.CSSProperties
                }
                onClick={() => phase === 'playing' && land(slideAt(tiles, size, index))}
              >
                {value}
              </button>
            ),
          )}
        </div>

        {phase !== 'playing' && (
          <div className="board-overlay">
            {phase === 'menu' && (
              <Result glyph="⏸️" title="Paused">
                <button className="primary" autoFocus onClick={() => setPhase('playing')}>
                  Carry on
                </button>
                <button onClick={() => deal(size)}>New puzzle</button>
                <button onClick={() => deal(size === 3 ? 4 : 3)}>
                  {size === 3 ? 'Try 4 × 4' : 'Back to 3 × 3'}
                </button>
              </Result>
            )}
            {phase === 'solved' && (
              <Result glyph="🧩" title="Solved!" detail={`${moves} moves.`}>
                <button className="primary" autoFocus onClick={() => deal(size)}>
                  Another one
                </button>
                <button onClick={() => deal(size === 3 ? 4 : 3)}>
                  {size === 3 ? 'Try 4 × 4' : 'Back to 3 × 3'}
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
        <span className="hint-remote">Arrows slide a tile into the gap · OK for the menu</span>
        <span className="hint-touch">Tap a tile, or swipe, to slide it</span>
      </p>
      <Confetti burst={burst} />
    </div>
  );
}
