import { useCallback, useEffect, useState } from 'react';
import type { ActivityApi } from './ActivityShell';
import { useAutoFocusFirst } from '../tv';
import { shuffle } from './random';

/**
 * Memory Match.
 *
 * The youngest band had four activities, and three of them asked a child to
 * read, type or plan. This one asks nothing but attention, which is why it
 * belongs at the bottom of the age range: a five-year-old can play it on the
 * first attempt with no instruction and no adult sitting next to them.
 *
 * Working memory is the thing being practised and it is worth naming, because
 * a parent looking at a grid of animal faces will otherwise file this under
 * "game" rather than "learning" -- and holding four things in your head while
 * you look for a fifth is most of what school asks of a seven-year-old.
 */
const FACES = [
  '🦊', '🐼', '🐸', '🦁', '🐙', '🦉', '🐢', '🦜',
  '🐝', '🦋', '🐬', '🦔', '🐧', '🐿️',
];

interface Board {
  /** Pairs, so the grid has twice this many cards. */
  pairs: number;
  columns: number;
}

const BOARDS: Board[] = [
  { pairs: 3, columns: 3 },
  { pairs: 6, columns: 4 },
  { pairs: 8, columns: 4 },
  { pairs: 10, columns: 5 },
];

interface Card {
  key: number;
  face: string;
  matched: boolean;
}

function deal(pairs: number): Card[] {
  const faces = shuffle(FACES).slice(0, pairs);
  return shuffle([...faces, ...faces]).map((face, key) => ({ key, face, matched: false }));
}

export function MemoryGame({ activity }: { activity: ActivityApi }) {
  const [boardIndex, setBoardIndex] = useState(0);
  const [cards, setCards] = useState<Card[]>(() => deal(BOARDS[0]!.pairs));
  const [facingUp, setFacingUp] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [cleared, setCleared] = useState(0);

  const board = BOARDS[Math.min(boardIndex, BOARDS.length - 1)]!;
  const won = cards.length > 0 && cards.every((c) => c.matched);

  useAutoFocusFirst([boardIndex]);

  const start = useCallback((index: number) => {
    setCards(deal(BOARDS[Math.min(index, BOARDS.length - 1)]!.pairs));
    setFacingUp([]);
    setMoves(0);
  }, []);

  /*
   * Two cards up: either they match and stay, or they go back over. The pause
   * is the whole game -- turning them back instantly would leave nothing to
   * remember.
   *
   * The board being finished is worked out here rather than in an effect
   * watching `won`. An effect that increments a counter it also reads has to
   * either lie in its dependency list or guard itself with a ref; knowing
   * before the timeout whether this pair is the last one needs neither.
   */
  useEffect(() => {
    if (facingUp.length !== 2) return;
    const [a, b] = facingUp as [number, number];
    const same = cards[a]!.face === cards[b]!.face;
    const lastPair = same && cards.filter((c) => !c.matched).length === 2;

    const timer = setTimeout(
      () => {
        if (same) {
          setCards((current) =>
            current.map((c, i) => (i === a || i === b ? { ...c, matched: true } : c)),
          );
        }
        setFacingUp([]);
        if (lastPair) {
          setCleared((done) => {
            const clearedNow = done + 1;
            activity.report('puzzles_solved', clearedNow);
            activity.report('level', boardIndex + 1);
            return clearedNow;
          });
        }
      },
      same ? 320 : 900,
    );
    return () => clearTimeout(timer);
  }, [facingUp, cards, activity, boardIndex]);

  const flip = (index: number) => {
    if (facingUp.length === 2 || cards[index]!.matched || facingUp.includes(index)) return;
    setFacingUp((up) => [...up, index]);
    if (facingUp.length === 1) setMoves((m) => m + 1);
  };

  const best = activity.best('puzzles_solved');

  return (
    <div className="play-stage">
      <p className="muted" style={{ margin: 0 }}>
        {board.pairs} pairs · {moves} {moves === 1 ? 'try' : 'tries'}
        {cleared > 0 ? ` · ${cleared} cleared` : ''}
        {best !== null && best > cleared ? ` · best ${best}` : ''}
      </p>

      <div
        className="memory-board"
        style={{ gridTemplateColumns: `repeat(${board.columns}, 1fr)` }}
        aria-label="Memory board"
      >
        {cards.map((card, index) => {
          const up = card.matched || facingUp.includes(index);
          return (
            <button
              key={card.key}
              className={`memory-card ${up ? 'up' : ''} ${card.matched ? 'matched' : ''}`}
              onClick={() => flip(index)}
              disabled={card.matched}
              aria-label={up ? card.face : 'Face down card'}
            >
              <span aria-hidden="true">{up ? card.face : '?'}</span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" style={{ minHeight: '2.4em' }}>
        {won && (
          <div className="stack" style={{ alignItems: 'center', gap: 10 }}>
            <strong>All matched! 🎉</strong>
            <div className="row">
              {boardIndex < BOARDS.length - 1 && (
                <button
                  className="primary"
                  onClick={() => {
                    const next = boardIndex + 1;
                    setBoardIndex(next);
                    start(next);
                  }}
                >
                  Bigger board →
                </button>
              )}
              <button onClick={() => start(boardIndex)}>Play again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
