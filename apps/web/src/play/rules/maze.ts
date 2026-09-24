import type { Dir } from '../kit';

/**
 * Mazes, generated.
 *
 * A depth-first carve, which makes a "perfect" maze: exactly one route between
 * any two cells, no loops, nothing unreachable. That last property is the one
 * that matters -- a maze with a sealed-off goal is a maze a child cannot finish,
 * and it is tested rather than assumed.
 *
 * Each cell is a bitmask of the walls still standing around it.
 */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface Maze {
  cols: number;
  rows: number;
  walls: number[];
}

const MOVES: Record<Dir, { bit: number; back: number; dx: number; dy: number }> = {
  up: { bit: N, back: S, dx: 0, dy: -1 },
  right: { bit: E, back: W, dx: 1, dy: 0 },
  down: { bit: S, back: N, dx: 0, dy: 1 },
  left: { bit: W, back: E, dx: -1, dy: 0 },
};

export function generate(cols: number, rows: number, rand = Math.random): Maze {
  const walls = new Array<number>(cols * rows).fill(N | E | S | W);
  const seen = new Array<boolean>(cols * rows).fill(false);
  // Iterative, not recursive: a 15x15 maze is 225 frames deep, which is fine
  // on a laptop and a stack overflow waiting to happen on an old TV browser.
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const at = stack[stack.length - 1]!;
    const x = at % cols;
    const y = Math.floor(at / cols);
    const open = (Object.values(MOVES) as Array<(typeof MOVES)[Dir]>).filter(({ dx, dy }) => {
      const [nx, ny] = [x + dx, y + dy];
      return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx];
    });
    if (open.length === 0) {
      stack.pop();
      continue;
    }
    const { bit, back, dx, dy } = open[Math.floor(rand() * open.length)]!;
    const next = (y + dy) * cols + (x + dx);
    walls[at] = walls[at]! & ~bit;
    walls[next] = walls[next]! & ~back;
    seen[next] = true;
    stack.push(next);
  }
  return { cols, rows, walls };
}

/** Where a step from `at` lands, or null if a wall is in the way. */
export function stepFrom(maze: Maze, at: number, dir: Dir): number | null {
  const { bit, dx, dy } = MOVES[dir];
  if (maze.walls[at]! & bit) return null;
  const x = (at % maze.cols) + dx;
  const y = Math.floor(at / maze.cols) + dy;
  if (x < 0 || y < 0 || x >= maze.cols || y >= maze.rows) return null;
  return y * maze.cols + x;
}

/** Steps on the shortest route between two cells. Every cell is reachable, so never -1 for a real maze. */
export function shortestPath(maze: Maze, from: number, to: number): number {
  const dist = new Array<number>(maze.walls.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === to) return dist[at]!;
    for (const dir of Object.keys(MOVES) as Dir[]) {
      const next = stepFrom(maze, at, dir);
      if (next !== null && dist[next] === -1) {
        dist[next] = dist[at]! + 1;
        queue.push(next);
      }
    }
  }
  return -1;
}

/** Levels grow by two cells a side, to a ceiling that still reads on a phone. */
export function sizeForLevel(level: number): number {
  return Math.min(5 + (level - 1) * 2, 17);
}
