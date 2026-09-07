import { DEFAULT_TIMEZONE, localDayKey } from './time.js';

/**
 * The weekly challenge.
 *
 * A subscription needs a heartbeat -- a reason to open the thing on a Tuesday
 * when nobody has asked you to. This is that reason, and it is deliberately the
 * cheapest possible one: a prompt, chosen by the calendar, identical for every
 * household in the country, computed on the client from the date.
 *
 * Three properties are doing the work here, and each one is a decision:
 *
 * 1. **It is the same for everyone.** Nothing is personalised, which means
 *    nothing has to be tracked to personalise it. DPDP 2023 s.9 bars
 *    behavioural monitoring of children outright, so a recommender that learns
 *    what a child likes is not a feature we are choosing not to build -- it is
 *    one we are not allowed to build. A shared prompt is also the more social
 *    object: two cousins can compare Wednesday's drawings precisely because
 *    they were given the same instruction.
 *
 * 2. **It expires quietly.** A week passes and the next one arrives. There is
 *    no streak, no counter of weeks missed, and nothing that goes red. Loss
 *    aversion works on children -- that is exactly why it has no place here.
 *    A child who skips three weeks comes back to a fresh prompt and no debt.
 *
 * 3. **It needs no server.** The function below is pure. It works in the
 *    preview on the public site, where there is no account, and it works on a
 *    TV with a flaky connection, and it will keep working if the API is down.
 */
export interface Challenge {
  id: string;
  /** Short enough to read on a television from three metres away. */
  title: string;
  /** The instruction itself, addressed to the child. One sentence. */
  prompt: string;
  /** Which activity it is done in. Must be a catalogue id. */
  appId: string;
  /**
   * What the child is actually practising, in a parent's words rather than a
   * teacher's. This is the line that makes a parent forward the certificate,
   * so it says what was learnt, not what was drawn.
   */
  grownUp: string;
}

/**
 * Twenty prompts, so nothing repeats within about five months.
 *
 * Weighted towards the activities every age band can open -- paint, typing,
 * blocks and numbers -- because a challenge a seven-year-old cannot attempt is
 * a week in which the youngest child in the house has nothing to do. Writer and
 * Code appear, but sparingly.
 *
 * Every prompt is answerable in one sitting and has no wrong answer. A weekly
 * challenge that can be failed is a weekly opportunity to feel bad.
 */
export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'window',
    title: 'The view from your window',
    prompt: 'Draw exactly what you can see out of one window in your house.',
    appId: 'paint',
    grownUp: 'Observational drawing — looking properly at something ordinary before drawing it.',
  },
  {
    id: 'fewest-blocks',
    title: 'Fewest blocks',
    prompt: 'Get the robot home using as few blocks as you possibly can.',
    appId: 'blocks',
    grownUp: 'Optimisation: a plan that works, then the same plan made shorter.',
  },
  {
    id: 'name-blind',
    title: 'Your name, eyes up',
    prompt: 'Type your whole name without once looking down at the keyboard.',
    appId: 'typing',
    grownUp: 'Touch typing. The looking-down habit is much easier to not form than to break.',
  },
  {
    id: 'twenty',
    title: 'Twenty in a row',
    prompt: 'Answer twenty questions. Getting one wrong does not stop the run.',
    appId: 'numbers',
    grownUp: 'Mental arithmetic at speed, with mistakes deliberately made cost-free.',
  },
  {
    id: 'homework-machine',
    title: 'The homework machine',
    prompt: 'Draw a machine that does your homework for you. Label the parts.',
    appId: 'paint',
    grownUp: 'Invention and labelling — the first step towards a diagram rather than a picture.',
  },
  {
    id: 'suddenly',
    title: 'Six suddenlys',
    prompt: 'Write six sentences. Every single one has to start with "Suddenly".',
    appId: 'writer',
    grownUp: 'Writing under a constraint, which is where most of a writer’s invention comes from.',
  },
  {
    id: 'beat-yourself',
    title: 'Beat last week',
    prompt: 'Look at your best score. Beat it by one.',
    appId: 'numbers',
    grownUp: 'Competing against a past self rather than against another child.',
  },
  {
    id: 'family-animals',
    title: 'Your family as animals',
    prompt: 'Draw everyone in your house as the animal they most remind you of.',
    appId: 'paint',
    grownUp: 'Character and likeness — deciding what a person is like, then showing it.',
  },
  {
    id: 'puzzle-five',
    title: 'Puzzle five',
    prompt: 'Get all the way to the last puzzle. Take as many tries as you need.',
    appId: 'blocks',
    grownUp: 'Persistence on a problem that does not yield on the first attempt.',
  },
  {
    id: 'forty-clean',
    title: 'Forty seconds clean',
    prompt: 'Type for forty seconds without a single mistake.',
    appId: 'typing',
    grownUp: 'Accuracy before speed, which is the order that actually produces speed.',
  },
  {
    id: 'colour-click',
    title: 'Click to change',
    prompt: 'Make a page that changes colour every time you click it.',
    appId: 'code',
    grownUp: 'Events: the idea that code can sit and wait for a person to do something.',
  },
  {
    id: 'noisiest',
    title: 'The noisiest thing',
    prompt: 'Draw the loudest, noisiest thing you can think of — with no sound.',
    appId: 'paint',
    grownUp: 'Representing something in a medium that cannot hold it directly.',
  },
  {
    id: 'cat-outside',
    title: 'Why the cat stays out',
    prompt:
      'Write a story whose last line is "and that is why the cat will not come inside."',
    appId: 'writer',
    grownUp: 'Working backwards from an ending, which is how most plots are actually built.',
  },
  {
    id: 'ten-streak',
    title: 'Ten right, no stops',
    prompt: 'Get ten correct one after another. Slowly counts.',
    appId: 'numbers',
    grownUp: 'Sustained concentration — harder, and more useful, than a single fast answer.',
  },
  {
    id: 'house-flag',
    title: 'A flag for your house',
    prompt: 'Design a flag for your family. Every colour has to mean something.',
    appId: 'paint',
    grownUp: 'Symbols: making a shape stand for an idea, and being able to say which.',
  },
  {
    id: 'first-time',
    title: 'Right first time',
    prompt: 'Write the whole plan before you press Run, and get it right on the first go.',
    appId: 'blocks',
    grownUp:
      'Reading a program in your head before running it — the single most useful habit in programming.',
  },
  {
    id: 'weather-no-hot',
    title: 'Today, without "hot"',
    prompt: 'Describe today’s weather. You may not use the word "hot".',
    appId: 'writer',
    grownUp: 'Vocabulary, forced. The banned word is the one that stops them reaching further.',
  },
  {
    id: 'button-surprise',
    title: 'The surprising button',
    prompt: 'Build a button that says something different every time you press it.',
    appId: 'code',
    grownUp: 'Randomness and arrays, arriving as a joke rather than as a lesson.',
  },
  {
    id: 'thirty',
    title: 'You, at thirty',
    prompt: 'Draw yourself at thirty years old, doing the job you would like.',
    appId: 'paint',
    grownUp: 'A drawing worth keeping. Date it — this one is worth having in ten years.',
  },
  {
    id: 'sentence-race',
    title: 'One whole sentence',
    prompt: 'Type one full sentence — capital letter, full stop — as fast as you can.',
    appId: 'typing',
    grownUp: 'Punctuation keys, which are the ones every typing game quietly skips.',
  },
];

/** Monday 5 January 2026, in the household's local terms. Weeks start here. */
const EPOCH_DAY = Date.UTC(2026, 0, 5) / 86_400_000;

const dayNumber = (at: Date, timeZone: string): number => {
  const [year, month, day] = localDayKey(at, timeZone).split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
};

/**
 * Which week we are in, counted from the epoch. Negative before it, which is
 * fine -- the caller wraps with a modulo that handles negatives.
 *
 * Computed from the *local* day rather than from UTC, so a household in
 * Kolkata rolls over to the new challenge at their own midnight on Monday and
 * not at half past five on Sunday evening.
 */
export function weekIndex(at: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  return Math.floor((dayNumber(at, timeZone) - EPOCH_DAY) / 7);
}

/** The Monday and Sunday bounding a week, as dates, for display only. */
export function weekWindow(
  at: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const start = (EPOCH_DAY + weekIndex(at, timeZone) * 7) * 86_400_000;
  return { start: new Date(start), end: new Date(start + 6 * 86_400_000) };
}

/** This week's prompt. Pure, deterministic, and identical for every household. */
export function challengeForWeek(
  at: Date,
  timeZone: string = DEFAULT_TIMEZONE,
): Challenge {
  const n = CHALLENGES.length;
  const index = ((weekIndex(at, timeZone) % n) + n) % n;
  return CHALLENGES[index]!;
}

/**
 * `2026-W36`. Stable key for "which challenge was this", safe to store.
 *
 * Proper ISO-8601 numbering, decided by the Thursday of the week -- so the key
 * matches what a calendar, a spreadsheet and `date +%G-W%V` all say, rather
 * than being a private numbering that only agrees with itself. The week
 * boundary is still our Monday, which is the same Monday ISO uses.
 */
export function challengeWeekKey(at: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const { start } = weekWindow(at, timeZone);
  const thursday = new Date(start.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
