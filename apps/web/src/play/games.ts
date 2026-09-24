import { createElement, lazy, Suspense } from 'react';
import type { ActivityApi } from './ActivityShell';

/**
 * The games themselves, without the frame around them.
 *
 * Each activity is two pieces: a game that knows nothing except how to be
 * played, and a shell that owns the session, the clock and the personal bests.
 * This registry is what joins them, twice over: the signed-in routes and the
 * public preview both mount a game from here inside their own shell, and the
 * games cannot tell which one they are in.
 *
 * It is also the whole cost of a new activity on the client: an entry here and
 * one in the catalogue. The routes are derived from the two -- there used to be
 * a wrapper component per activity and a hand-kept list of routes as well, and
 * three lists that must agree are two more than necessary.
 */
export type Game = React.ComponentType<{ activity: ActivityApi }>;

/*
 * Each game is its own file, fetched when it is opened rather than with the
 * page. The home page a parent reads on a phone over mobile data used to carry
 * all nineteen games inside it; now it carries none, and a game costs its own
 * few kilobytes the first time a child opens it.
 */
type Loader = () => Promise<Record<string, unknown>>;

const LOADERS: Record<string, [Loader, string]> = {
  paint: [() => import('./Paint'), 'PaintCanvas'],
  typing: [() => import('./Typing'), 'TypingGame'],
  blocks: [() => import('./Blocks'), 'BlocksGame'],
  numbers: [() => import('./Numbers'), 'NumbersGame'],
  writer: [() => import('./Writer'), 'WriterPad'],
  code: [() => import('./Code'), 'Playground'],
  memory: [() => import('./Memory'), 'MemoryGame'],
  spell: [() => import('./Spell'), 'SpellGame'],
  piano: [() => import('./Piano'), 'PianoKeyboard'],
  tables: [() => import('./Tables'), 'TablesGame'],
  india: [() => import('./India'), 'IndiaGame'],
  snake: [() => import('./Snake'), 'SnakeGame'],
  tictactoe: [() => import('./TicTacToe'), 'TicTacToeGame'],
  fourrow: [() => import('./FourRow'), 'FourRowGame'],
  echo: [() => import('./Echo'), 'EchoGame'],
  maze: [() => import('./Maze'), 'MazeGame'],
  slide: [() => import('./Slide'), 'SlideGame'],
  bricks: [() => import('./Bricks'), 'BricksGame'],
  merge: [() => import('./Merge'), 'MergeGame'],
};

export const GAMES: Record<string, Game> = Object.fromEntries(
  Object.entries(LOADERS).map(([id, [load, name]]) => [
    id,
    lazy(async () => ({ default: (await load())[name] as Game })),
  ]),
);

/**
 * Fetch these games now, quietly, so opening one is instant.
 *
 * The child's launcher calls it with the games that child may open. A TV on a
 * slow connection would otherwise show a loading tile after every press of OK;
 * the browser caches each file, so this costs nothing the second time.
 */
export function preloadGames(ids: readonly string[]): void {
  for (const id of ids) void LOADERS[id]?.[0]().catch(() => {});
}

/** A game in its slot, with a placeholder the size of a game while it loads. */
export function GameSlot({ Game, activity }: { Game: Game; activity: ActivityApi }) {
  return createElement(
    Suspense,
    { fallback: createElement('div', { className: 'skeleton game-loading', 'aria-busy': true }) },
    createElement(Game, { activity }),
  );
}
