import type { ActivityApi } from './ActivityShell';
import { BlocksGame } from './Blocks';
import { Playground } from './Code';
import { NumbersGame } from './Numbers';
import { PaintCanvas } from './Paint';
import { TypingGame } from './Typing';
import { WriterPad } from './Writer';

/**
 * The games themselves, without the frame around them.
 *
 * Each activity is two pieces: a game that knows nothing except how to be
 * played, and a shell that owns the session, the clock and the personal bests.
 * That split already existed; this registry is what makes it useful, because
 * the same game can now be mounted in a second shell.
 *
 * The second shell is the public preview -- no account, no session, no server.
 * It is the whole reason a visiting parent can put something in front of their
 * child before deciding anything, and it costs nothing to serve because these
 * activities were always going to run in the client.
 */
export type Game = React.ComponentType<{ activity: ActivityApi }>;

export const GAMES: Record<string, Game> = {
  paint: PaintCanvas,
  typing: TypingGame,
  blocks: BlocksGame,
  numbers: NumbersGame,
  writer: WriterPad,
  code: Playground,
};
