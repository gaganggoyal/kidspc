import { useCallback, useEffect, useState } from 'react';
import type { ActivityApi } from './ActivityShell';

/**
 * Block Puzzles.
 *
 * The first real programming idea a child meets here: a plan written in
 * advance, run all at once, that fails in a way you have to read back and fix.
 * Deliberately not a live-steering game -- the gap between writing the sequence
 * and seeing it run is where the learning is.
 */
type Command = 'forward' | 'left' | 'right';

const GLYPH: Record<Command, string> = { forward: '⬆︎', left: '↰', right: '↱' };
const LABEL: Record<Command, string> = { forward: 'Go', left: 'Turn left', right: 'Turn right' };
/** The letter on the keyboard that adds each block; shown once one is in use. */
const KEY_FOR: Record<Command, string> = { forward: 'G', left: 'L', right: 'R' };

interface Level {
  size: number;
  start: [number, number];
  facing: number; // 0 = up, clockwise
  goal: [number, number];
  walls: Array<[number, number]>;
  par: number;
}

const LEVELS: Level[] = [
  { size: 4, start: [0, 3], facing: 0, goal: [0, 0], walls: [], par: 3 },
  { size: 4, start: [0, 3], facing: 0, goal: [3, 0], walls: [[1, 1]], par: 6 },
  { size: 5, start: [0, 4], facing: 0, goal: [4, 0], walls: [[1, 2], [2, 2], [3, 3]], par: 8 },
  { size: 5, start: [2, 4], facing: 0, goal: [2, 0], walls: [[2, 2], [1, 1], [3, 1]], par: 10 },
  { size: 6, start: [0, 5], facing: 0, goal: [5, 0], walls: [[1, 4], [2, 3], [3, 2], [4, 1], [2, 1]], par: 12 },
];

const DELTAS: Array<[number, number]> = [
  [0, -1], // up
  [1, 0], // right
  [0, 1], // down
  [-1, 0], // left
];

export function BlocksGame({ activity }: { activity: ActivityApi }) {
  const [levelIndex, setLevelIndex] = useState(0);
  const [program, setProgram] = useState<Command[]>([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [robot, setRobot] = useState<{ x: number; y: number; facing: number }>({
    x: 0,
    y: 0,
    facing: 0,
  });
  const [outcome, setOutcome] = useState<'won' | 'crashed' | 'stopped' | null>(null);
  const [solved, setSolved] = useState(0);

  const level = LEVELS[Math.min(levelIndex, LEVELS.length - 1)]!;

  const reset = useCallback(() => {
    setRobot({ x: level.start[0], y: level.start[1], facing: level.facing });
    setStep(0);
    setRunning(false);
    setOutcome(null);
  }, [level]);

  useEffect(() => {
    reset();
    setProgram([]);
  }, [levelIndex, reset]);

  // Runs one command per tick so a child can watch where their plan goes wrong,
  // which is the entire debugging lesson.
  useEffect(() => {
    if (!running) return;
    if (step >= program.length) {
      setRunning(false);
      setOutcome((o) => o ?? 'stopped');
      return;
    }
    const timer = setTimeout(() => {
      setRobot((current) => {
        const command = program[step]!;
        if (command === 'left') return { ...current, facing: (current.facing + 3) % 4 };
        if (command === 'right') return { ...current, facing: (current.facing + 1) % 4 };

        const [dx, dy] = DELTAS[current.facing]!;
        const x = current.x + dx;
        const y = current.y + dy;
        const offGrid = x < 0 || y < 0 || x >= level.size || y >= level.size;
        const intoWall = level.walls.some(([wx, wy]) => wx === x && wy === y);
        if (offGrid || intoWall) {
          setOutcome('crashed');
          setRunning(false);
          return current;
        }
        if (x === level.goal[0] && y === level.goal[1]) {
          setOutcome('won');
          setRunning(false);
          const solvedNow = solved + 1;
          setSolved(solvedNow);
          activity.report('puzzles_solved', solvedNow);
          activity.report('level', levelIndex + 1);
        }
        return { ...current, x, y };
      });
      setStep((s) => s + 1);
    }, 420);
    return () => clearTimeout(timer);
  }, [running, step, program, level, levelIndex, solved, activity]);

  /*
   * The same three blocks, on three keys.
   *
   * This is the activity a keyboard changes most. A twelve-block programme is
   * twelve journeys across the palette with a D-pad, and the plan is long
   * enough by then that a child has forgotten what they were planning. The
   * letters match the words on the buttons -- G for Go, L and R for the turns
   * -- with Enter to run it and Backspace reserved, because the shell already
   * reads that as "leave".
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches?.('input, textarea, [contenteditable]')) return;

      const key = event.key.toLowerCase();
      if (key === 'enter') {
        // Enter on a focused button is that button's own click; only claim it
        // when focus is nowhere in particular.
        if (target && target !== document.body && target.matches('button, [href]')) return;
        if (running || program.length === 0) return;
        event.preventDefault();
        reset();
        setRunning(true);
        return;
      }
      if (running) return;

      const command = ({ g: 'forward', l: 'left', r: 'right' } as const)[key];
      if (command) {
        if (program.length >= 20) return;
        event.preventDefault();
        setProgram((p) => [...p, command]);
        return;
      }
      if (key === 'u') {
        event.preventDefault();
        setProgram((p) => p.slice(0, -1));
      }
      if (key === 'c') {
        event.preventDefault();
        setProgram([]);
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, program.length, reset]);

  const cells = [];
  for (let y = 0; y < level.size; y++) {
    for (let x = 0; x < level.size; x++) {
      const isWall = level.walls.some(([wx, wy]) => wx === x && wy === y);
      const isGoal = level.goal[0] === x && level.goal[1] === y;
      const isRobot = robot.x === x && robot.y === y;
      cells.push(
        <div key={`${x}-${y}`} className={`cell ${isWall ? 'wall' : ''} ${isGoal ? 'goal' : ''}`}>
          {isRobot ? (
            <span className="robot" style={{ transform: `rotate(${robot.facing * 90}deg)` }}>
              ▲
            </span>
          ) : isGoal ? (
            '🏠'
          ) : null}
        </div>,
      );
    }
  }

  return (
    <div className="blocks-layout">
      <div className="stack" style={{ alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>
          Puzzle {levelIndex + 1} of {LEVELS.length} · {program.length}/{level.par} blocks used
        </p>
        <div
          className="grid-board"
          style={{ gridTemplateColumns: `repeat(${level.size}, 1fr)` }}
          aria-label="Puzzle board"
        >
          {cells}
        </div>
        <div aria-live="assertive" style={{ minHeight: '1.6em' }}>
          {outcome === 'won' && <strong>Home! 🎉</strong>}
          {outcome === 'crashed' && <span className="muted">Bumped into something. Try again!</span>}
          {outcome === 'stopped' && <span className="muted">Ran out of blocks.</span>}
        </div>
      </div>

      <div className="stack">
        <strong>Your plan</strong>
        <div className="program" aria-label="Your program">
          {program.length === 0 && <span className="muted small">Add blocks below →</span>}
          {program.map((command, index) => (
            <span key={index} className={`block ${running && index === step ? 'active' : ''}`}>
              {GLYPH[command]}
            </span>
          ))}
        </div>

        <div className="chips">
          {(Object.keys(GLYPH) as Command[]).map((command) => (
            <button
              key={command}
              className="chip"
              disabled={running || program.length >= 20}
              onClick={() => setProgram((p) => [...p, command])}
            >
              {GLYPH[command]} {LABEL[command]}
              <kbd className="key-hint">{KEY_FOR[command]}</kbd>
            </button>
          ))}
        </div>

        <div className="row">
          <button
            className="primary"
            disabled={running || program.length === 0}
            onClick={() => {
              reset();
              setRunning(true);
            }}
          >
            ▶ Run
            <kbd className="key-hint">↵</kbd>
          </button>
          <button disabled={running} onClick={() => setProgram((p) => p.slice(0, -1))}>
            Undo
            <kbd className="key-hint">U</kbd>
          </button>
          <button disabled={running} onClick={() => { setProgram([]); reset(); }}>
            Clear
            <kbd className="key-hint">C</kbd>
          </button>
          {outcome === 'won' && levelIndex < LEVELS.length - 1 && (
            <button className="primary" onClick={() => setLevelIndex((i) => i + 1)}>
              Next puzzle →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
