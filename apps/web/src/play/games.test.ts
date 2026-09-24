import { describe, expect, it } from 'vitest';
import { canMove, move, slideLine } from './rules/merge';
import { isSolvable, isSolved, scramble, slideAt, slideDir, solvedTiles } from './rules/slide';
import { newSnake, type SnakeState, step, turn } from './rules/snake';
import { type Cell, isFull as tttFull, robotMove as tttRobot, winner } from './rules/tictactoe';
import { COLS, drop, emptyBoard, lineThrough, robotMove as fourRobot } from './rules/fourRow';
import { generate, shortestPath, stepFrom } from './rules/maze';

/**
 * The rules of the arcade games.
 *
 * Each of these is a place a child would notice a bug before an adult did: a
 * merge that counted twice, a puzzle that could not be solved, a robot that
 * missed a win in front of it, a maze with the cheese walled off.
 */

/** A seeded generator, so a failure here is the same failure on every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('2048', () => {
  it('merges each tile at most once per move', () => {
    expect(slideLine([2, 2, 2, 2]).line).toEqual([4, 4, 0, 0]);
    expect(slideLine([2, 2, 4, 0]).line).toEqual([4, 4, 0, 0]);
    expect(slideLine([4, 0, 4, 4]).line).toEqual([8, 4, 0, 0]);
    expect(slideLine([2, 4, 8, 16]).line).toEqual([2, 4, 8, 16]);
  });

  it('scores the value of every merged tile', () => {
    expect(slideLine([2, 2, 4, 4]).gained).toBe(12);
  });

  it('slides in all four directions', () => {
    // prettier-ignore
    const board = [
      2, 0, 0, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
    ];
    expect(move(board, 4, 'left').board.slice(0, 4)).toEqual([4, 0, 0, 0]);
    expect(move(board, 4, 'right').board.slice(0, 4)).toEqual([0, 0, 0, 4]);
    const up = move(board, 4, 'up').board;
    expect([up[0], up[12]]).toEqual([4, 0]);
    const down = move(board, 4, 'down').board;
    expect([down[0], down[12]]).toEqual([0, 4]);
  });

  it('reports a move that changes nothing, so no tile is spawned for it', () => {
    expect(move([2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4, 'left').moved).toBe(false);
  });

  it('knows when the board is stuck', () => {
    expect(canMove([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], 4)).toBe(false);
    expect(canMove([2, 2, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], 4)).toBe(true);
  });
});

describe('Slide Puzzle', () => {
  it('scrambles into positions that can always be solved', () => {
    const rand = seeded(7);
    for (const size of [3, 4]) {
      for (let i = 0; i < 100; i++) {
        const tiles = scramble(size, rand);
        expect(isSolved(tiles)).toBe(false);
        expect(isSolvable(tiles, size)).toBe(true);
      }
    }
  });

  it('moves the tile the arrow names, into the gap', () => {
    // Gap at the bottom right; "left" pulls nothing, "right" pushes 8 in.
    const solved = solvedTiles(3);
    expect(slideDir(solved, 3, 'left')).toBeNull();
    expect(slideDir(solved, 3, 'right')).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 8]);
    expect(slideDir(solved, 3, 'down')).toEqual([1, 2, 3, 4, 5, 0, 7, 8, 6]);
  });

  it('slides a whole row when a tile further along it is chosen', () => {
    expect(slideAt(solvedTiles(3), 3, 6)).toEqual([1, 2, 3, 4, 5, 6, 0, 7, 8]);
    expect(slideAt(solvedTiles(3), 3, 0)).toBeNull();
  });
});

describe('Snake', () => {
  it('grows by one for each apple and not otherwise', () => {
    let s = newSnake(10, false, seeded(1));
    s = { ...s, food: { x: s.body[0]!.x + 1, y: s.body[0]!.y } };
    const ate = step(s, seeded(2));
    expect(ate.ate).toBe(true);
    expect(ate.state.body).toHaveLength(4);
    const moved = step({ ...ate.state, food: { x: 0, y: 0 } });
    expect(moved.state.body).toHaveLength(4);
  });

  it('ends the round at a wall, unless the walls wrap', () => {
    let s = newSnake(5, false);
    s = { ...s, food: { x: 0, y: 0 } };
    for (let i = 0; i < 3 && s.alive; i++) s = step(s).state;
    expect(s.alive).toBe(false);

    let w: SnakeState = { ...newSnake(5, true), food: { x: 0, y: 0 } };
    for (let i = 0; i < 6; i++) w = step(w).state;
    expect(w.alive).toBe(true);
  });

  it('ignores a turn straight back into its own neck', () => {
    const s = newSnake(10, false);
    expect(turn(s, 'left').queue).toEqual([]);
    expect(turn(s, 'up').queue).toEqual(['up']);
  });

  it('dies on its own body', () => {
    // A snake of five coiled so that turning down runs into itself.
    let s: SnakeState = {
      ...newSnake(10, false),
      body: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
      ],
      dir: 'right',
      food: { x: 0, y: 0 },
    };
    s = turn(s, 'down');
    expect(step(s).state.alive).toBe(false);
  });
});

describe('Tic-Tac-Toe', () => {
  it('finds every kind of line', () => {
    const b: Cell[] = ['X', 'O', null, 'O', 'X', null, null, null, 'X'];
    expect(winner(b)).toEqual({ mark: 'X', line: [0, 4, 8] });
  });

  it('takes a win that is in front of it, at either skill', () => {
    const b: Cell[] = ['O', 'O', null, 'X', 'X', null, null, null, null];
    expect(tttRobot(b, 'O', 'hard')).toBe(2);
    expect(tttRobot(b, 'O', 'easy')).toBe(2);
  });

  it('cannot be beaten on hard, over hundreds of random opponents', () => {
    const rand = seeded(42);
    for (let game = 0; game < 300; game++) {
      const board: Cell[] = Array(9).fill(null);
      let turnMark: 'X' | 'O' = game % 2 ? 'X' : 'O';
      while (!winner(board) && !tttFull(board)) {
        const free = board.flatMap((c, i) => (c ? [] : [i]));
        const at =
          turnMark === 'O'
            ? tttRobot(board, 'O', 'hard', rand)
            : free[Math.floor(rand() * free.length)]!;
        board[at] = turnMark;
        turnMark = turnMark === 'X' ? 'O' : 'X';
      }
      expect(winner(board)?.mark).not.toBe('X');
    }
  });
});

describe('Four in a Row', () => {
  it('stacks counters from the bottom', () => {
    const a = drop(emptyBoard(), 3, 1)!;
    const b = drop(a.board, 3, 2)!;
    expect([a.row, b.row]).toEqual([5, 4]);
  });

  it('sees a diagonal', () => {
    let board = emptyBoard();
    // Build a staircase so player 1 lands on (5,0) (4,1) (3,2) (2,3).
    const plan: Array<[number, 1 | 2]> = [
      [0, 1],
      [1, 2],
      [1, 1],
      [2, 2],
      [2, 2],
      [2, 1],
      [3, 2],
      [3, 2],
      [3, 2],
    ];
    for (const [col, who] of plan) board = drop(board, col, who)!.board;
    const last = drop(board, 3, 1)!;
    expect(lineThrough(last.board, last.row, 3)).toHaveLength(4);
  });

  it('takes a win and blocks a loss on hard', () => {
    let board = emptyBoard();
    for (const col of [0, 1, 2]) board = drop(board, col, 2)!.board;
    expect(fourRobot(board, 2, 'hard')).toBe(3);
    expect(fourRobot(board, 1, 'hard')).toBe(3);
  });

  it('answers quickly enough for a television', () => {
    const started = performance.now();
    fourRobot(emptyBoard(), 2, 'hard');
    expect(performance.now() - started).toBeLessThan(1500);
    expect(COLS).toBe(7);
  });
});

describe('Maze', () => {
  it('leaves no cell unreachable, at every size a level can ask for', () => {
    const rand = seeded(3);
    for (const size of [5, 9, 13, 17]) {
      const maze = generate(size, size, rand);
      for (let cell = 0; cell < size * size; cell++)
        expect(shortestPath(maze, 0, cell)).toBeGreaterThanOrEqual(0);
    }
  });

  it('has walls that agree from both sides', () => {
    const maze = generate(9, 9, seeded(9));
    for (let cell = 0; cell < 81; cell++) {
      const right = stepFrom(maze, cell, 'right');
      if (right !== null) expect(stepFrom(maze, right, 'left')).toBe(cell);
      const down = stepFrom(maze, cell, 'down');
      if (down !== null) expect(stepFrom(maze, down, 'up')).toBe(cell);
    }
  });
});
