import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, type Dir, Hud, Result, TouchPad, useArrowKeys, useSwipe } from './kit';
import {
  E,
  generate,
  type Maze,
  N,
  S,
  shortestPath,
  sizeForLevel,
  stepFrom,
  W,
} from './rules/maze';

/**
 * Maze.
 *
 * A mouse, some cheese, and a new maze every time. Each one is a little bigger
 * than the last, and at the end the child is told how their route compared
 * with the shortest one -- not as a score to beat, but because "was there a
 * quicker way?" is the question that turns wandering into route-finding.
 *
 * The cells already walked stay lit. A trail is how a person actually solves a
 * maze on paper, and without one a five-year-old walks the same dead end three
 * times and decides mazes are boring.
 */
type Phase = 'playing' | 'found';

/**
 * An emoji that scales with its cell. Text sized in `em` cannot follow a cell
 * whose width is a fraction of the board, and the board's width is a fraction
 * of the screen; an SVG with a viewBox simply fills whatever box it is given.
 */
function Sprite({ glyph }: { glyph: string }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <text x="5" y="8.4" fontSize="8.4" textAnchor="middle">
        {glyph}
      </text>
    </svg>
  );
}

function newMaze(level: number): Maze {
  const size = sizeForLevel(level);
  return generate(size, size);
}

export function MazeGame({ activity }: { activity: ActivityApi }) {
  const board = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState(1);
  const [maze, setMaze] = useState<Maze>(() => newMaze(1));
  const [at, setAt] = useState(0);
  const [steps, setSteps] = useState(0);
  const [trail, setTrail] = useState<Set<number>>(() => new Set([0]));
  const [phase, setPhase] = useState<Phase>('playing');
  const [burst, setBurst] = useState(0);

  const goal = maze.cols * maze.rows - 1;
  const shortest = useMemo(() => shortestPath(maze, 0, goal), [maze, goal]);

  useEffect(() => {
    if (phase === 'playing') board.current?.focus();
  }, [phase]);

  const go = useCallback(
    (dir: Dir) => {
      if (phase !== 'playing') return;
      const next = stepFrom(maze, at, dir);
      if (next === null) {
        sfx.bounce();
        return;
      }
      sfx.move();
      setAt(next);
      setSteps((s) => s + 1);
      setTrail((t) => new Set(t).add(next));
      if (next === goal) {
        sfx.win();
        setBurst((n) => n + 1);
        activity.report('level', level);
        setPhase('found');
      }
    },
    [phase, maze, at, goal, level, activity],
  );

  const load = (nextLevel: number) => {
    setLevel(nextLevel);
    setMaze(newMaze(nextLevel));
    setAt(0);
    setSteps(0);
    setTrail(new Set([0]));
    setPhase('playing');
  };

  // Held arrows repeat here, unlike in the puzzles: holding right is how you
  // run down a long corridor.
  useArrowKeys({ onDir: go }, phase === 'playing', { repeat: true });
  useSwipe(board, go, phase === 'playing');

  const perfect = steps === shortest;

  return (
    <div className="arcade">
      <Hud
        items={[
          ['maze', level],
          ['steps', steps],
        ]}
      />

      <div className="board-wrap">
        <div
          ref={board}
          className="game-board maze-board"
          tabIndex={-1}
          aria-label={`Maze ${level}, ${maze.cols} by ${maze.rows}`}
          style={{ '--n': maze.cols } as React.CSSProperties}
        >
          {maze.walls.map((walls, cell) => {
            const x = cell % maze.cols;
            const y = Math.floor(cell / maze.cols);
            // Each cell draws only its top and left walls, plus the outer edge
            // on the last row and column -- otherwise every inner wall is drawn
            // twice, once from each side, and comes out double thickness.
            const cls = [
              'maze-cell',
              walls & N ? 'n' : '',
              walls & W ? 'w' : '',
              x === maze.cols - 1 && walls & E ? 'e' : '',
              y === maze.rows - 1 && walls & S ? 's' : '',
              trail.has(cell) ? 'trail' : '',
            ].join(' ');
            return (
              <span key={cell} className={cls}>
                {cell === at ? <Sprite glyph="🐭" /> : cell === goal ? <Sprite glyph="🧀" /> : null}
              </span>
            );
          })}
        </div>

        {phase === 'found' && (
          <div className="board-overlay">
            <Result
              glyph={perfect ? '🌟' : '🧀'}
              title={perfect ? 'The shortest way!' : 'You found the cheese!'}
              detail={
                perfect
                  ? `${steps} steps — nobody could have done it in fewer.`
                  : `${steps} steps. The shortest way was ${shortest}.`
              }
            >
              <button className="primary" autoFocus onClick={() => load(level + 1)}>
                Bigger maze →
              </button>
              <button onClick={() => load(level)}>Same size again</button>
            </Result>
          </div>
        )}
      </div>

      {phase === 'playing' && <TouchPad onDir={go} />}
      <p className="play-hint">
        <span className="hint-remote">Arrows to move · hold to run</span>
        <span className="hint-touch">Swipe or use the arrows to move</span>
      </p>
      <Confetti burst={burst} />
    </div>
  );
}
