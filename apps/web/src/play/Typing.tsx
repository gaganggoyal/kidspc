import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';

/**
 * Typing Garden.
 *
 * Keyboard literacy is the least glamorous and most useful thing on the
 * Explorer track -- a child who cannot find the keys cannot use anything else
 * here. The plant is the whole reward loop: it grows one stage per word, so
 * progress is visible after ten seconds rather than after a lesson.
 */
const WORDS: Record<string, string[]> = {
  easy: ['sun', 'cat', 'dog', 'run', 'red', 'big', 'top', 'hat', 'bus', 'cup', 'pen', 'box'],
  medium: ['garden', 'yellow', 'rocket', 'planet', 'bridge', 'monkey', 'window', 'pencil'],
  hard: ['keyboard', 'elephant', 'mountain', 'computer', 'birthday', 'sandwich', 'umbrella'],
};

const STAGES = ['🌱', '🌿', '🪴', '🌷', '🌻', '🌳'];

export function TypingGame({ activity }: { activity: ActivityApi }) {
  const [level, setLevel] = useState<keyof typeof WORDS>('easy');
  const [word, setWord] = useState('');
  const [typed, setTyped] = useState('');
  const [grown, setGrown] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const startedAt = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const nextWord = useCallback((forLevel: keyof typeof WORDS) => {
    const list = WORDS[forLevel]!;
    setWord(list[Math.floor(Math.random() * list.length)]!);
    setTyped('');
  }, []);

  useEffect(() => nextWord(level), [level, nextWord]);

  // The keyboard is the entire interface, so focus must never drift away from
  // the input -- including after a stray click on a TV's touchpad.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const timer = setInterval(focus, 1500);
    return () => clearInterval(timer);
  }, []);

  const onChange = (value: string) => {
    if (startedAt.current === null) startedAt.current = Date.now();
    const lower = value.toLowerCase().slice(0, word.length);
    // Count a mistake only when a newly typed character is wrong, so holding a
    // key down does not bury a child under errors.
    if (lower.length > typed.length) {
      const index = lower.length - 1;
      if (lower[index] === word[index]) setCorrect((c) => c + 1);
      else setMistakes((m) => m + 1);
    }
    setTyped(lower);

    if (lower === word) {
      const grownNow = grown + 1;
      setGrown(grownNow);
      const minutes = (Date.now() - (startedAt.current ?? Date.now())) / 60_000;
      const wpm = minutes > 0 ? correct / 5 / minutes : 0;
      const accuracy = correct + mistakes > 0 ? (correct / (correct + mistakes)) * 100 : 100;

      activity.report('words_written', grownNow);
      if (grownNow % 5 === 0) {
        activity.report('words_per_minute', Math.min(200, Math.round(wpm)));
        activity.report('accuracy_pct', Math.round(accuracy));
      }
      setTimeout(() => nextWord(level), 350);
    }
  };

  const accuracy = correct + mistakes > 0 ? Math.round((correct / (correct + mistakes)) * 100) : 100;
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(grown / 3))]!;
  const best = activity.best('words_written');

  return (
    <div className="play-stage">
      <div className="chips" role="group" aria-label="Difficulty">
        {(Object.keys(WORDS) as Array<keyof typeof WORDS>).map((id) => (
          <button key={id} className="chip" aria-pressed={level === id} onClick={() => setLevel(id)}>
            {id}
          </button>
        ))}
      </div>

      <div style={{ fontSize: '5em', lineHeight: 1 }} aria-hidden="true">
        {stage}
      </div>

      <p className="muted" style={{ margin: 0 }}>
        {grown} word{grown === 1 ? '' : 's'} grown
        {best !== null && best > grown ? ` · best ${best}` : ''} · {accuracy}% accurate
      </p>

      <div className="typing-word" aria-label={`Type the word ${word}`}>
        {word.split('').map((letter, index) => {
          const state =
            index >= typed.length ? 'pending' : typed[index] === letter ? 'right' : 'wrong';
          return (
            <span key={index} className={`letter ${state}`}>
              {letter}
            </span>
          );
        })}
      </div>

      {/* Invisible but real: mobile and TV keyboards only appear for a focused
          input, so a synthetic key handler would lock out half the devices. */}
      <input
        ref={inputRef}
        className="typing-input"
        value={typed}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Type here"
      />
    </div>
  );
}

export function Typing() {
  return (
    <ActivityShell appId="typing" title="Typing Garden">
      {(activity) => <TypingGame activity={activity} />}
    </ActivityShell>
  );
}
