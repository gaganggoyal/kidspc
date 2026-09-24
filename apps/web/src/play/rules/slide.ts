import type { Dir } from '../kit';

/**
 * The sliding puzzle, as rules.
 *
 * Tiles are numbers with `0` for the gap. Half of all arrangements of a
 * sliding puzzle cannot be solved, and handing a child one of those is handing
 * them a puzzle that is broken in a way they will blame themselves for. So the
 * board is never shuffled: it is *scrambled*, by making random legal moves
 * backwards from the solution, and every position reached that way can be
 * walked back.
 */
export type Tiles = number[];

export function solvedTiles(size: number): Tiles {
  return [...Array.from({ length: size * size - 1 }, (_, i) => i + 1), 0];
}

export function isSolved(tiles: Tiles): boolean {
  return tiles.every((v, i) => v === (i === tiles.length - 1 ? 0 : i + 1));
}

/**
 * Press an arrow and the tile beside the gap moves that way into it.
 *
 * That is the convention every sliding puzzle with a keyboard has used: the
 * arrow names where the *tile* goes, not where the gap goes, because the tile
 * is the thing a child is looking at.
 */
export function slideDir(tiles: Tiles, size: number, dir: Dir): Tiles | null {
  const gap = tiles.indexOf(0);
  const gx = gap % size;
  const gy = Math.floor(gap / size);
  // The tile that moves sits on the opposite side of the gap from `dir`.
  const from = { up: [gx, gy + 1], down: [gx, gy - 1], left: [gx + 1, gy], right: [gx - 1, gy] }[
    dir
  ];
  const [fx, fy] = from as [number, number];
  if (fx < 0 || fy < 0 || fx >= size || fy >= size) return null;
  const next = [...tiles];
  const at = fy * size + fx;
  next[gap] = next[at]!;
  next[at] = 0;
  return next;
}

/**
 * A tile chosen by pointing at it. Anything in line with the gap moves, and
 * so do the tiles between -- the way a real one behaves under a thumb.
 */
export function slideAt(tiles: Tiles, size: number, index: number): Tiles | null {
  const gap = tiles.indexOf(0);
  const [gx, gy, tx, ty] = [
    gap % size,
    Math.floor(gap / size),
    index % size,
    Math.floor(index / size),
  ];
  if (index === gap || (gx !== tx && gy !== ty)) return null;
  const dir: Dir = gx === tx ? (ty > gy ? 'up' : 'down') : tx > gx ? 'left' : 'right';
  let next: Tiles = tiles;
  const steps = Math.abs(tx - gx) + Math.abs(ty - gy);
  for (let i = 0; i < steps; i++) next = slideDir(next, size, dir)!;
  return next;
}

export function scramble(size: number, rand = Math.random): Tiles {
  const dirs: Dir[] = ['up', 'down', 'left', 'right'];
  const undo: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  let tiles = solvedTiles(size);
  let last: Dir | null = null;
  // Enough moves that the result is properly mixed, without undoing the move
  // just made -- which would waste half of them.
  for (let moves = 0; moves < size * size * 25 || isSolved(tiles);) {
    const dir = dirs[Math.floor(rand() * 4)]!;
    if (last && dir === undo[last]) continue;
    const next = slideDir(tiles, size, dir);
    if (!next) continue;
    tiles = next;
    last = dir;
    moves++;
  }
  return tiles;
}

/** The textbook parity test. Only used by the tests, as a check on `scramble`. */
export function isSolvable(tiles: Tiles, size: number): boolean {
  const seq = tiles.filter((v) => v !== 0);
  let inversions = 0;
  for (let i = 0; i < seq.length; i++)
    for (let j = i + 1; j < seq.length; j++) if (seq[i]! > seq[j]!) inversions++;
  if (size % 2 === 1) return inversions % 2 === 0;
  const gapRowFromBottom = size - Math.floor(tiles.indexOf(0) / size);
  return (inversions + gapRowFromBottom) % 2 === 1;
}
