import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { sfx } from '../sfx';
import { Confetti, Hud } from './kit';
import {
  type Board,
  COLS,
  drop,
  dropRow,
  emptyBoard,
  isFull,
  lineThrough,
  ROWS,
  robotMove,
} from './rules/fourRow';

/**
 * Four in a Row.
 *
 * Each column is one button. That is the whole remote design: left and right
 * choose where, OK drops -- two decisions, which is all the game ever asks for.
 * A counter that falls into place is drawn falling, because "it goes to the
 * bottom" is the rule a five-year-old has to discover, and watching it happen
 * teaches it faster than any sentence would.
 *
 * Red always belongs to the child. Against the robot, whoever lost the last
 * round starts the next one, which quietly hands a struggling child the
 * advantage of going first.
 */
type Mode = 'easy' | 'hard' | 'two';
type Who = 1 | 2;

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'easy', label: '🤖 Easy robot' },
  { id: 'hard', label: '🦾 Hard robot' },
  { id: 'two', label: '👫 Two players' },
];

export function FourRowGame({ activity }: { activity: ActivityApi }) {
  const [mode, setMode] = useState<Mode>('easy');
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [turn, setTurn] = useState<Who>(1);
  const [last, setLast] = useState<{ row: number; col: number } | null>(null);
  const [line, setLine] = useState<number[] | null>(null);
  const [tally, setTally] = useState({ 1: 0, 2: 0 });
  const [wins, setWins] = useState(0);
  const [burst, setBurst] = useState(0);
  const columns = useRef<HTMLDivElement>(null);

  const full = isFull(board);
  const over = Boolean(line) || full;
  const robotsTurn = mode !== 'two' && turn === 2 && !over;

  const focusColumn = useCallback(
    (col: number) => columns.current?.querySelectorAll<HTMLButtonElement>('.c4-col')[col]?.focus(),
    [],
  );

  // Start over the middle column: it is the strongest opening and the one
  // every other column is nearest to.
  useEffect(() => {
    focusColumn(3);
  }, [focusColumn]);

  const play = useCallback(
    (col: number, who: Who) => {
      if (line) return;
      const placed = drop(board, col, who);
      if (!placed) {
        sfx.bounce();
        return;
      }
      sfx.place();
      setBoard(placed.board);
      setLast({ row: placed.row, col });
      const won = lineThrough(placed.board, placed.row, col);
      if (won) {
        setLine(won);
        setTally((t) => ({ ...t, [who]: t[who] + 1 }));
        if (who === 1 || mode === 'two') {
          sfx.win();
          setBurst((n) => n + 1);
          if (mode !== 'two') {
            const count = wins + 1;
            setWins(count);
            activity.report('score', count);
          }
        } else {
          sfx.over();
        }
      } else if (isFull(placed.board)) {
        sfx.bounce();
      }
      setTurn(who === 1 ? 2 : 1);
    },
    [board, line, mode, wins, activity],
  );

  useEffect(() => {
    if (!robotsTurn) return;
    const timer = setTimeout(
      () => play(robotMove(board, 2, mode === 'hard' ? 'hard' : 'easy'), 2),
      600,
    );
    return () => clearTimeout(timer);
  }, [robotsTurn, board, mode, play]);

  const newRound = (starter: Who) => {
    setBoard(emptyBoard());
    setLine(null);
    setLast(null);
    setTurn(starter);
    focusColumn(3);
  };

  const pickMode = (next: Mode) => {
    setMode(next);
    setTally({ 1: 0, 2: 0 });
    newRound(1);
  };

  const names = mode === 'two' ? { 1: 'Red', 2: 'Yellow' } : { 1: 'You', 2: 'Robot' };
  const winnerWho = line ? (board[line[0]!] as Who) : null;
  const status = winnerWho
    ? winnerWho === 1 || mode === 'two'
      ? `${names[winnerWho]} ${mode === 'two' ? 'wins' : 'win'}! 🎉`
      : 'The robot got four in a row.'
    : full
      ? 'The board is full — a draw.'
      : robotsTurn
        ? 'Robot is thinking…'
        : mode === 'two'
          ? `${names[turn]}’s turn`
          : 'Your turn — pick a column';

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
          [names[1], tally[1]],
          [names[2], tally[2]],
        ]}
      />

      <div ref={columns} className="c4-board" role="group" aria-label="Four in a row board">
        {Array.from({ length: COLS }, (_, col) => {
          const space = dropRow(board, col) + 1;
          return (
            <button
              key={col}
              className={`c4-col turn-${turn}`}
              aria-disabled={space === 0 || over || robotsTurn}
              aria-label={`Column ${col + 1}, ${space} ${space === 1 ? 'space' : 'spaces'} left`}
              onClick={() => !over && !robotsTurn && play(col, turn)}
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const at = row * COLS + col;
                const disc = board[at];
                const falling = last && last.row === row && last.col === col;
                return (
                  <span key={row} className={`c4-cell ${line?.includes(at) ? 'win' : ''}`}>
                    {disc !== 0 && (
                      <i
                        className={`c4-disc p${disc} ${falling ? 'falling' : ''}`}
                        style={falling ? ({ '--fall': row + 1 } as React.CSSProperties) : undefined}
                      />
                    )}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>

      <p className="turn-line" aria-live="polite">
        {!over && !robotsTurn && <i className={`c4-disc p${turn} inline`} aria-hidden="true" />}
        {status}
      </p>

      {over && (
        <button
          className="primary"
          autoFocus
          // The loser starts, against the robot; in a two-player game, the
          // other colour does.
          onClick={() =>
            newRound(mode === 'two' ? (winnerWho === 1 ? 2 : 1) : winnerWho === 2 ? 1 : 2)
          }
        >
          Play again
        </button>
      )}
      <Confetti burst={burst} />
    </div>
  );
}
