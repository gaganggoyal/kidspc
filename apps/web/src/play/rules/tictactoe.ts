/**
 * Tic-tac-toe, and a robot to play it against.
 *
 * Two robots, in fact, and the difference matters more than it looks. The hard
 * one plays perfectly -- it cannot be beaten, only drawn against -- and a
 * five-year-old who only ever meets that one learns that the game is
 * unwinnable. The easy one takes a win when it sees it and otherwise plays
 * anywhere, so a child who has learnt to make a fork can beat it and find out
 * why forks work. Moving from one robot to the other is the lesson.
 */
export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Skill = 'easy' | 'hard';

export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function winner(board: readonly Cell[]): { mark: Mark; line: readonly number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return { mark, line };
  }
  return null;
}

export const isFull = (board: readonly Cell[]) => board.every((c) => c !== null);
const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');
const free = (board: readonly Cell[]) => board.flatMap((c, i) => (c === null ? [i] : []));

/**
 * Positive when `me` is winning. Faster wins and slower losses score better.
 *
 * `seen` caches positions for the life of one decision. Within one decision
 * the depth of a position is fixed by how many cells are filled, so a cached
 * score is exact -- and there are only 5,478 reachable positions, against the
 * half-million nodes an uncached search from an empty board visits. That
 * difference was a tenth of a second on a laptop, which is most of a second on
 * a television.
 */
function minimax(
  board: Cell[],
  me: Mark,
  turn: Mark,
  depth: number,
  seen: Map<string, number>,
): number {
  const key = board.map((c) => c ?? '-').join('') + turn;
  const cached = seen.get(key);
  if (cached !== undefined) return cached;

  const won = winner(board);
  let best: number;
  if (won) best = won.mark === me ? 10 - depth : depth - 10;
  else if (isFull(board)) best = 0;
  else {
    best = turn === me ? -Infinity : Infinity;
    for (const i of free(board)) {
      board[i] = turn;
      const score = minimax(board, me, other(turn), depth + 1, seen);
      board[i] = null;
      best = turn === me ? Math.max(best, score) : Math.min(best, score);
    }
  }
  seen.set(key, best);
  return best;
}

function winningMove(board: readonly Cell[], mark: Mark): number | null {
  for (const i of free(board)) {
    const trial = [...board];
    trial[i] = mark;
    if (winner(trial)?.mark === mark) return i;
  }
  return null;
}

export function robotMove(
  board: readonly Cell[],
  me: Mark,
  skill: Skill,
  rand = Math.random,
): number {
  const options = free(board);
  if (options.length === 0) return -1;

  if (skill === 'easy') {
    // Sees its own win, and sometimes sees the child's -- so a child has to
    // actually set up two threats, not merely leave one open, to beat it.
    const win = winningMove(board, me);
    if (win !== null) return win;
    const block = winningMove(board, other(me));
    if (block !== null && rand() < 0.5) return block;
    return options[Math.floor(rand() * options.length)]!;
  }

  // Perfect play, choosing at random among equally good moves so the robot
  // does not open the same way every single game.
  const work = [...board];
  const seen = new Map<string, number>();
  let bestScore = -Infinity;
  let best: number[] = [];
  for (const i of options) {
    work[i] = me;
    const score = minimax(work, me, other(me), 1, seen);
    work[i] = null;
    if (score > bestScore) [bestScore, best] = [score, [i]];
    else if (score === bestScore) best.push(i);
  }
  return best[Math.floor(rand() * best.length)]!;
}
