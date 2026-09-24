import type { Dir } from '../kit';

/**
 * 2048, as rules.
 *
 * The one subtle rule is the one every clone gets wrong at least once: a tile
 * merges at most once per move. `2 2 4` slid left is `4 4`, not `8`, and
 * `2 2 2 2` is `4 4`, not `8`. It is tested because it is the thing that makes
 * the game about planning rather than luck.
 */
export type Board = number[];

/** One row, slid towards index 0. `merged` is where in the row a merge landed. */
export function slideLine(line: readonly number[]): {
  line: number[];
  gained: number;
  merged: number[];
} {
  const tiles = line.filter((v) => v !== 0);
  const out: number[] = [];
  const merged: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      const value = tiles[i]! * 2;
      merged.push(out.length);
      out.push(value);
      gained += value;
      i++;
    } else {
      out.push(tiles[i]!);
    }
  }
  while (out.length < line.length) out.push(0);
  return { line: out, gained, merged };
}

/** The indices of one line, ordered so that index 0 is the edge being slid towards. */
function lineIndices(size: number, dir: Dir, n: number): number[] {
  return Array.from({ length: size }, (_, k) => {
    switch (dir) {
      case 'left':
        return n * size + k;
      case 'right':
        return n * size + (size - 1 - k);
      case 'up':
        return k * size + n;
      case 'down':
        return (size - 1 - k) * size + n;
    }
  });
}

export function move(
  board: Board,
  size: number,
  dir: Dir,
): { board: Board; gained: number; moved: boolean; merged: number[] } {
  const next = [...board];
  const merged: number[] = [];
  let gained = 0;
  for (let n = 0; n < size; n++) {
    const indices = lineIndices(size, dir, n);
    const slid = slideLine(indices.map((i) => board[i]!));
    indices.forEach((i, k) => (next[i] = slid.line[k]!));
    merged.push(...slid.merged.map((k) => indices[k]!));
    gained += slid.gained;
  }
  return { board: next, gained, moved: next.some((v, i) => v !== board[i]), merged };
}

/** A new tile in an empty cell: a 2 nine times in ten, otherwise a 4. */
export function spawn(board: Board, rand = Math.random): { board: Board; at: number } {
  const empty = board.flatMap((v, i) => (v === 0 ? [i] : []));
  if (empty.length === 0) return { board, at: -1 };
  const at = empty[Math.floor(rand() * empty.length)]!;
  const next = [...board];
  next[at] = rand() < 0.9 ? 2 : 4;
  return { board: next, at };
}

export function newBoard(size: number, rand = Math.random): Board {
  const first = spawn(new Array<number>(size * size).fill(0), rand).board;
  return spawn(first, rand).board;
}

export function canMove(board: Board, size: number): boolean {
  return (['left', 'right', 'up', 'down'] as const).some((dir) => move(board, size, dir).moved);
}
