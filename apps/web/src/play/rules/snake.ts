import type { Dir } from '../kit';

/**
 * Snake, as rules with no screen attached.
 *
 * Kept apart from the component so the parts that decide whether a child has
 * lost -- the wall, their own tail -- are tested rather than trusted. A game
 * that ends a round unfairly is the one a child stops playing.
 */
export interface Point {
  x: number;
  y: number;
}

export interface SnakeState {
  size: number;
  /** Head first. */
  body: Point[];
  dir: Dir;
  /**
   * Turns pressed but not yet taken. Two, because a child pressing up-then-left
   * quickly inside one tick means both, and a snake that drops the second press
   * feels like it ignored them.
   */
  queue: Dir[];
  food: Point | null;
  eaten: number;
  alive: boolean;
  /**
   * Walls that wrap to the other side instead of ending the round. The gentle
   * mode, for the youngest: they get to learn steering before they learn edges.
   */
  wrap: boolean;
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const STEP: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

export function placeFood(size: number, body: readonly Point[], rand = Math.random): Point | null {
  const free: Point[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (!body.some((p) => p.x === x && p.y === y)) free.push({ x, y });
  return free.length ? free[Math.floor(rand() * free.length)]! : null;
}

export function newSnake(size: number, wrap: boolean, rand = Math.random): SnakeState {
  const y = Math.floor(size / 2);
  const body = [2, 1, 0].map((x) => ({ x, y }));
  return {
    size,
    body,
    dir: 'right',
    queue: [],
    food: placeFood(size, body, rand),
    eaten: 0,
    alive: true,
    wrap,
  };
}

export function turn(state: SnakeState, dir: Dir): SnakeState {
  const last = state.queue[state.queue.length - 1] ?? state.dir;
  // Reversing into your own neck is never what a child meant.
  if (dir === last || dir === OPPOSITE[last] || state.queue.length >= 2) return state;
  return { ...state, queue: [...state.queue, dir] };
}

export function step(state: SnakeState, rand = Math.random): { state: SnakeState; ate: boolean } {
  if (!state.alive) return { state, ate: false };
  const [next, ...queue] = state.queue;
  const dir = next ?? state.dir;
  const head = state.body[0]!;
  let target = { x: head.x + STEP[dir].x, y: head.y + STEP[dir].y };

  const outside = target.x < 0 || target.y < 0 || target.x >= state.size || target.y >= state.size;
  if (outside) {
    if (!state.wrap) return { state: { ...state, dir, queue, alive: false }, ate: false };
    target = { x: (target.x + state.size) % state.size, y: (target.y + state.size) % state.size };
  }

  const ate = state.food !== null && same(target, state.food);
  // The tail moves out of the way this same tick unless the snake is growing,
  // so chasing your own tail round a tight loop is legal -- as it is in every
  // Snake anybody has played.
  const solid = ate ? state.body : state.body.slice(0, -1);
  if (solid.some((p) => same(p, target)))
    return { state: { ...state, dir, queue, alive: false }, ate: false };

  const body = [target, ...solid];
  const food = ate ? placeFood(state.size, body, rand) : state.food;
  return {
    state: {
      ...state,
      body,
      dir,
      queue,
      food,
      eaten: state.eaten + (ate ? 1 : 0),
      // A board with nowhere left for an apple has been won outright.
      alive: food !== null,
    },
    ate,
  };
}

/** Milliseconds per step: brisk from the start, a little faster every few apples. */
export function tickMs(eaten: number, fast: boolean): number {
  const base = fast ? 150 : 230;
  return Math.max(fast ? 70 : 120, base - Math.floor(eaten / 3) * 8);
}
