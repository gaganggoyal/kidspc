import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';
import { useAutoFocusFirst } from '../tv';
import { pickOther, shuffle } from './random';

/**
 * Spell It.
 *
 * A picture, its letters in the wrong order, and a row of buttons. No typing:
 * the letters are tapped or driven with a D-pad, so this works on a television
 * with a remote and on a tablet with no keyboard, which between them are most
 * of the devices this product runs on.
 *
 * Deliberately not a spelling *test*. A wrong letter is simply not accepted --
 * nothing is marked, nothing is counted against the child, and the word stays
 * on screen until it is finished. Accuracy is recorded for the parent's
 * dashboard because it is genuinely informative over weeks; it is never shown
 * to the child as a mark, because a five-year-old sounding out a word does not
 * need a percentage watching them do it.
 */
interface Word {
  word: string;
  glyph: string;
}

const WORDS: Record<'easy' | 'medium' | 'hard', Word[]> = {
  easy: [
    { word: 'cat', glyph: '🐱' }, { word: 'sun', glyph: '☀️' },
    { word: 'bus', glyph: '🚌' }, { word: 'cup', glyph: '🥤' },
    { word: 'dog', glyph: '🐶' }, { word: 'pen', glyph: '🖊️' },
    { word: 'bed', glyph: '🛏️' }, { word: 'key', glyph: '🔑' },
    { word: 'egg', glyph: '🥚' }, { word: 'fan', glyph: '🪭' },
  ],
  medium: [
    { word: 'mango', glyph: '🥭' }, { word: 'tiger', glyph: '🐯' },
    { word: 'train', glyph: '🚆' }, { word: 'house', glyph: '🏠' },
    { word: 'clock', glyph: '🕰️' }, { word: 'camel', glyph: '🐫' },
    { word: 'bread', glyph: '🍞' }, { word: 'river', glyph: '🏞️' },
    { word: 'kite', glyph: '🪁' }, { word: 'drum', glyph: '🥁' },
  ],
  hard: [
    { word: 'elephant', glyph: '🐘' }, { word: 'umbrella', glyph: '☂️' },
    { word: 'mountain', glyph: '⛰️' }, { word: 'peacock', glyph: '🦚' },
    { word: 'bicycle', glyph: '🚲' }, { word: 'rainbow', glyph: '🌈' },
    { word: 'lantern', glyph: '🏮' }, { word: 'coconut', glyph: '🥥' },
  ],
};

type Level = keyof typeof WORDS;
const LEVELS: Level[] = ['easy', 'medium', 'hard'];

export function SpellGame({ activity }: { activity: ActivityApi }) {
  const [level, setLevel] = useState<Level>('easy');
  const [target, setTarget] = useState<Word>(() => WORDS.easy[0]!);
  const [letters, setLetters] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(0);
  const [slips, setSlips] = useState(0);
  const [wobble, setWobble] = useState(false);
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);

  const next = useCallback((forLevel: Level, previous: Word | null) => {
    const word = pickOther(WORDS[forLevel], previous);
    setTarget(word);
    setLetters(shuffle([...word.word]));
    setTyped('');
  }, []);

  useEffect(() => {
    next(level, null);
  }, [level, next]);

  useAutoFocusFirst([target.word]);

  const complete = typed === target.word;

  // The word being finished is caused by a tap, so it is handled in the tap.
  // Watching for it from an effect meant an effect that incremented the very
  // counters it read, and whose cleanup then cancelled its own advance timer
  // the moment one of them changed.
  const finish = useCallback(() => {
    setDone((previous) => {
      const doneNow = previous + 1;
      activity.report('words_written', doneNow);
      const attempts = doneNow + slips;
      if (attempts > 0) activity.report('accuracy_pct', Math.round((doneNow / attempts) * 100));
      return doneNow;
    });
    // `target` itself, not a copy of it: pickOther compares by reference to
    // decide what not to draw again, and a rebuilt object matches nothing in
    // the list, so a copy would quietly turn repeat-avoidance off.
    advance.current = setTimeout(() => next(level, target), 1100);
  }, [activity, slips, next, level, target]);

  useEffect(() => () => { if (advance.current) clearTimeout(advance.current); }, []);

  const tap = useCallback(
    (letter: string, index: number) => {
      if (complete) return;
      const wanted = target.word[typed.length];
      if (letter !== wanted) {
        // Refused, not marked. The letter simply does not go in.
        setSlips((s) => s + 1);
        setWobble(true);
        setTimeout(() => setWobble(false), 300);
        return;
      }
      const now = typed + letter;
      setTyped(now);
      setLetters((current) => current.filter((_, i) => i !== index));
      if (now === target.word) finish();
    },
    [complete, target.word, typed, finish],
  );

  /*
   * Spell it by typing it.
   *
   * The tiles exist because a remote has no letters on it. A keyboard does,
   * and asking a child who can already reach the H key to arrow across to a
   * tile marked H instead is the interface getting in the way of the lesson.
   *
   * It goes through the same `tap` as a click, so a wrong letter is refused in
   * exactly the same way and the slip is counted once.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const letter = event.key.toLowerCase();
      if (letter < 'a' || letter > 'z') return;
      // The first tile bearing that letter; which of two identical tiles is
      // removed makes no difference to anything.
      const index = letters.indexOf(letter);
      if (index === -1) return;
      event.preventDefault();
      tap(letter, index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [letters, tap]);

  const best = activity.best('words_written');

  return (
    <div className="play-stage">
      <div className="chips" role="group" aria-label="Word length">
        {LEVELS.map((id) => (
          <button key={id} className="chip" aria-pressed={level === id} onClick={() => setLevel(id)}>
            {id}
          </button>
        ))}
      </div>

      <div className="play-glyph" aria-hidden="true">
        {target.glyph}
      </div>

      <p className="muted" style={{ margin: 0 }}>
        {done} spelt{best !== null && best > done ? ` · best ${best}` : ''}
      </p>

      <div className={`spell-slots ${wobble ? 'wobble' : ''}`} aria-label={`Spell the word`}>
        {[...target.word].map((letter, index) => (
          <span key={index} className={`slot ${index < typed.length ? 'filled' : ''}`}>
            {index < typed.length ? letter : ''}
          </span>
        ))}
      </div>

      <div className="spell-letters" role="group" aria-label="Letters">
        {letters.map((letter, index) => (
          <button
            key={`${letter}-${index}`}
            className="letter-key"
            onClick={() => tap(letter, index)}
            disabled={complete}
          >
            {letter}
          </button>
        ))}
      </div>

      <div aria-live="polite" style={{ minHeight: '1.6em' }}>
        {complete && <strong>{target.word.toUpperCase()}! 🎉</strong>}
      </div>
    </div>
  );
}

export function Spell() {
  return (
    <ActivityShell appId="spell" title="Spell It">
      {(activity) => <SpellGame activity={activity} />}
    </ActivityShell>
  );
}
