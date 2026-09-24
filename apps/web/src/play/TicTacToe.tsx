import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, Hud } from './kit';
import { type Cell, isFull, type Mark, robotMove, winner } from './rules/tictactoe';

/**
 * Tic-Tac-Toe.
 *
 * Nine buttons, so it is the one game here that needs nothing special from a
 * remote: spatial navigation already moves between them and OK already presses
 * one. Filled squares stay focusable -- `aria-disabled`, not `disabled` --
 * because a disabled button drops out of navigation, and a board with holes in
 * it is a board the arrows jump across in ways a child cannot predict.
 *
 * Who goes first alternates every round. The one who starts can never lose
 * against perfect play, and a robot that always started would be a robot that
 * always had the better half.
 */
type Mode = 'easy' | 'hard' | 'two';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'easy', label: '🤖 Easy robot' },
  { id: 'hard', label: '🦾 Hard robot' },
  { id: 'two', label: '👫 Two players' },
];

const empty = (): Cell[] => Array<Cell>(9).fill(null);

function MarkGlyph({ mark }: { mark: Mark }) {
  // Drawn, not typed: the glyph "X" and "O" differ by font, and a cross and a
  // ring should be told apart by shape from across a room.
  return mark === 'X' ? (
    <svg viewBox="0 0 100 100" className="ttt-mark x" aria-hidden="true">
      <path d="M22 22 L78 78 M78 22 L22 78" />
    </svg>
  ) : (
    <svg viewBox="0 0 100 100" className="ttt-mark o" aria-hidden="true">
      <circle cx="50" cy="50" r="30" />
    </svg>
  );
}

export function TicTacToeGame({ activity }: { activity: ActivityApi }) {
  const [mode, setMode] = useState<Mode>('easy');
  const [board, setBoard] = useState<Cell[]>(empty);
  const [starter, setStarter] = useState<Mark>('X');
  const [turn, setTurn] = useState<Mark>('X');
  const [tally, setTally] = useState({ X: 0, O: 0, draw: 0 });
  const [burst, setBurst] = useState(0);
  const [wins, setWins] = useState(0);
  const grid = useRef<HTMLDivElement>(null);

  // Arrive on the middle square, not on the first chip above the board: the
  // board is what a child came for, and the middle is one press from anything.
  useEffect(() => {
    grid.current?.querySelectorAll<HTMLButtonElement>('.ttt-cell')[4]?.focus();
  }, []);

  const won = winner(board);
  const over = Boolean(won) || isFull(board);
  const robotsTurn = mode !== 'two' && turn === 'O' && !over;

  const finish = useCallback(
    (next: Cell[]) => {
      const result = winner(next);
      if (!result && !isFull(next)) return;
      const key = result ? result.mark : 'draw';
      setTally((t) => ({ ...t, [key]: t[key] + 1 }));
      if (result && (mode === 'two' || result.mark === 'X')) {
        sfx.win();
        setBurst((n) => n + 1);
        if (mode !== 'two') {
          const count = wins + 1;
          setWins(count);
          activity.report('score', count);
        }
      } else if (result) {
        sfx.over();
      } else {
        sfx.bounce();
      }
    },
    [mode, wins, activity],
  );

  const play = useCallback(
    (index: number, mark: Mark) => {
      if (board[index] || winner(board)) return;
      const next = [...board];
      next[index] = mark;
      sfx.place();
      setBoard(next);
      setTurn(mark === 'X' ? 'O' : 'X');
      finish(next);
    },
    [board, finish],
  );

  useEffect(() => {
    if (!robotsTurn) return;
    // A pause, so the robot looks as though it is thinking and a child can see
    // their own move land before the reply arrives.
    const timer = setTimeout(
      () => play(robotMove(board, 'O', mode === 'hard' ? 'hard' : 'easy'), 'O'),
      520,
    );
    return () => clearTimeout(timer);
  }, [robotsTurn, board, mode, play]);

  const newRound = (nextStarter: Mark = starter === 'X' ? 'O' : 'X') => {
    setBoard(empty());
    setStarter(nextStarter);
    setTurn(nextStarter);
    // "Play again" is about to disappear with focus on it. The squares never
    // unmount, so the middle one can take focus now, and the remote starts
    // the next round where every opening is one press away.
    grid.current?.querySelectorAll<HTMLButtonElement>('.ttt-cell')[4]?.focus();
  };

  const pickMode = (next: Mode) => {
    setMode(next);
    setTally({ X: 0, O: 0, draw: 0 });
    newRound('X');
  };

  const names = mode === 'two' ? { X: 'Player 1', O: 'Player 2' } : { X: 'You', O: 'Robot' };
  const status = won
    ? won.mark === 'X' || mode === 'two'
      ? `${names[won.mark]} ${mode === 'two' ? 'wins' : 'win'}! 🎉`
      : 'The robot wins this one.'
    : over
      ? 'A draw — nobody wins.'
      : robotsTurn
        ? 'Robot is thinking…'
        : `${names[turn]}${mode === 'two' ? '’s' : 'r'} turn`;

  return (
    <div className="arcade">
      <div className="chips" role="group" aria-label="Who to play against">
        {MODES.map((m) => (
          <button
            key={m.id}
            className="chip"
            aria-pressed={mode === m.id}
            onClick={() => pickMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Hud
        items={[
          [names.X, tally.X],
          ['draws', tally.draw],
          [names.O, tally.O],
        ]}
      />

      <div ref={grid} className="ttt-board" role="group" aria-label="Tic-tac-toe board">
        {board.map((cell, i) => (
          <button
            key={i}
            className={`ttt-cell ${won?.line.includes(i) ? 'win' : ''}`}
            aria-disabled={Boolean(cell) || over || robotsTurn}
            aria-label={cell ? `${cell} in square ${i + 1}` : `Empty square ${i + 1}`}
            onClick={() => !robotsTurn && !over && play(i, turn)}
          >
            {cell && <MarkGlyph mark={cell} />}
          </button>
        ))}
      </div>

      <p className="turn-line" aria-live="polite">
        {!over && !robotsTurn && <MarkGlyph mark={turn} />}
        {status}
      </p>

      {over && (
        <button className="primary" autoFocus onClick={() => newRound()}>
          Play again
        </button>
      )}
      <Confetti burst={burst} />
    </div>
  );
}
