/**
 * Four in a row, and a robot for it.
 *
 * The board is row-major with row 0 at the top, which is how it is drawn:
 * a counter dropped into a column falls to the highest-numbered empty row.
 *
 * The robot searches a few moves ahead with alpha-beta pruning and scores the
 * positions it cannot see past by counting open lines. Depth is the only
 * difference between its two settings. It has to answer within a blink on a
 * television whose processor is mostly busy being a television, which is why
 * it searches centre columns first -- the order that makes pruning cut most.
 */
export const ROWS = 6;
export const COLS = 7;
export type Disc = 0 | 1 | 2;
export type Board = Disc[];

export const emptyBoard = (): Board => new Array<Disc>(ROWS * COLS).fill(0);

export function dropRow(board: Board, col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) if (board[row * COLS + col] === 0) return row;
  return -1;
}

export function drop(board: Board, col: number, who: 1 | 2): { board: Board; row: number } | null {
  const row = dropRow(board, col);
  if (row < 0) return null;
  const next = [...board];
  next[row * COLS + col] = who;
  return { board: next, row };
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

/** The four (or more) cells through (row, col) that make a line, if there is one. */
export function lineThrough(board: Board, row: number, col: number): number[] | null {
  const who = board[row * COLS + col];
  if (!who) return null;
  for (const [dr, dc] of DIRECTIONS) {
    const cells = [row * COLS + col];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === who) {
        cells.push(r * COLS + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

export const isFull = (board: Board) => board.slice(0, COLS).every((d) => d !== 0);

/** Every window of four cells on the board, computed once. */
const WINDOWS: number[][] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    for (const [dr, dc] of DIRECTIONS) {
      const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k] as const);
      if (cells.every(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS))
        WINDOWS.push(cells.map(([rr, cc]) => rr * COLS + cc));
    }

function evaluate(board: Board, me: 1 | 2): number {
  const them = me === 1 ? 2 : 1;
  let score = 0;
  for (let r = 0; r < ROWS; r++) if (board[r * COLS + 3] === me) score += 3;
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      if (board[i] === me) mine++;
      else if (board[i] === them) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 5;
    else if (mine === 2) score += 2;
    if (theirs === 3) score -= 6;
    else if (theirs === 2) score -= 2;
  }
  return score;
}

const ORDER = [3, 2, 4, 1, 5, 0, 6];

function negamax(board: Board, depth: number, alpha: number, beta: number, me: 1 | 2): number {
  if (isFull(board)) return 0;
  if (depth === 0) return evaluate(board, me);
  const them = me === 1 ? 2 : 1;
  let best = -Infinity;
  for (const col of ORDER) {
    const played = drop(board, col, me);
    if (!played) continue;
    // A win found sooner is worth more, so the robot finishes a game rather
    // than toying with it.
    const score = lineThrough(played.board, played.row, col)
      ? 1000 + depth
      : -negamax(played.board, depth - 1, -beta, -alpha, them);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export type Skill = 'easy' | 'hard';

export function robotMove(board: Board, me: 1 | 2, skill: Skill, rand = Math.random): number {
  const legal = ORDER.filter((c) => dropRow(board, c) >= 0);
  if (legal.length === 0) return -1;
  const them = me === 1 ? 2 : 1;

  if (skill === 'easy') {
    // Takes a win, usually spots a loss coming, otherwise plays loosely
    // towards the middle -- beatable by a child who looks two moves ahead.
    for (const col of legal) {
      const p = drop(board, col, me)!;
      if (lineThrough(p.board, p.row, col)) return col;
    }
    if (rand() < 0.6)
      for (const col of legal) {
        const p = drop(board, col, them)!;
        if (lineThrough(p.board, p.row, col)) return col;
      }
    const weighted = legal.flatMap((c) => Array<number>(4 - Math.abs(3 - c)).fill(c));
    return weighted[Math.floor(rand() * weighted.length)]!;
  }

  let best = -Infinity;
  let choices: number[] = [];
  for (const col of legal) {
    const p = drop(board, col, me)!;
    const score = lineThrough(p.board, p.row, col)
      ? 10_000
      : -negamax(p.board, 4, -Infinity, Infinity, them);
    if (score > best) [best, choices] = [score, [col]];
    else if (score === best) choices.push(col);
  }
  return choices[Math.floor(rand() * choices.length)]!;
}
