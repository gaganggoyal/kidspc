import type { ActivityApi } from './ActivityShell';
import { BlocksGame } from './Blocks';
import { BricksGame } from './Bricks';
import { EchoGame } from './Echo';
import { FourRowGame } from './FourRow';
import { IndiaGame } from './India';
import { MazeGame } from './Maze';
import { MemoryGame } from './Memory';
import { MergeGame } from './Merge';
import { PianoKeyboard } from './Piano';
import { SlideGame } from './Slide';
import { SnakeGame } from './Snake';
import { SpellGame } from './Spell';
import { TablesGame } from './Tables';
import { TicTacToeGame } from './TicTacToe';
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

export const GAMES: Record<string, Game> = {
  paint: PaintCanvas,
  typing: TypingGame,
  blocks: BlocksGame,
  numbers: NumbersGame,
  writer: WriterPad,
  code: Playground,
  memory: MemoryGame,
  spell: SpellGame,
  piano: PianoKeyboard,
  tables: TablesGame,
  india: IndiaGame,
  snake: SnakeGame,
  tictactoe: TicTacToeGame,
  fourrow: FourRowGame,
  echo: EchoGame,
  maze: MazeGame,
  slide: SlideGame,
  bricks: BricksGame,
  merge: MergeGame,
};
