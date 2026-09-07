import { useCallback, useEffect, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';
import { useAutoFocusFirst } from '../tv';

/**
 * Number Ninja.
 *
 * Four large answer buttons rather than a number entry field: this has to be
 * fully playable with a D-pad and nothing else, because a remote is the only
 * input some households will have to hand.
 */
type Op = '+' | '-' | '×';

interface Question {
  prompt: string;
  answer: number;
  choices: number[];
}

function build(level: number): Question {
  const ops: Op[] = level < 3 ? ['+'] : level < 5 ? ['+', '-'] : ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)]!;
  const ceiling = op === '×' ? Math.min(12, 3 + level) : 5 + level * 4;

  let a = 1 + Math.floor(Math.random() * ceiling);
  let b = 1 + Math.floor(Math.random() * ceiling);
  // Keep subtraction non-negative: negative numbers are a different lesson.
  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

  // Distractors near the answer, so guessing by magnitude does not work.
  const choices = new Set<number>([answer]);
  while (choices.size < 4) {
    const delta = Math.ceil(Math.random() * Math.max(3, Math.round(answer * 0.25)));
    const wrong = answer + (Math.random() < 0.5 ? -delta : delta);
    if (wrong >= 0 && wrong !== answer) choices.add(wrong);
  }
  return {
    prompt: `${a} ${op} ${b}`,
    answer,
    choices: [...choices].sort(() => Math.random() - 0.5),
  };
}

export function NumbersGame({ activity }: { activity: ActivityApi }) {
  const [level, setLevel] = useState(1);
  const [streak, setStreak] = useState(0);
  const [solved, setSolved] = useState(0);
  const [question, setQuestion] = useState<Question>(() => build(1));
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);

  useAutoFocusFirst([question]);

  const next = useCallback((forLevel: number) => {
    setQuestion(build(forLevel));
    setVerdict(null);
  }, []);

  const answer = (choice: number) => {
    if (verdict) return;
    if (choice === question.answer) {
      const solvedNow = solved + 1;
      const streakNow = streak + 1;
      setSolved(solvedNow);
      setStreak(streakNow);
      setVerdict('right');
      activity.report('puzzles_solved', solvedNow);

      // Five in a row moves up. Levelling on a streak rather than a total means
      // a child who is finding it easy stops being bored quickly.
      if (streakNow > 0 && streakNow % 5 === 0) {
        const next = Math.min(10, level + 1);
        setLevel(next);
        activity.report('level', next);
      }
    } else {
      setStreak(0);
      setVerdict('wrong');
    }
  };

  useEffect(() => {
    if (!verdict) return;
    const timer = setTimeout(() => next(level), verdict === 'right' ? 500 : 1100);
    return () => clearTimeout(timer);
  }, [verdict, level, next]);

  const best = activity.best('puzzles_solved');

  return (
    <div className="play-stage">
      <p className="muted" style={{ margin: 0 }}>
        Level {level} · {solved} solved{best !== null && best > solved ? ` · best ${best}` : ''}
        {streak >= 2 ? ` · ${streak} in a row!` : ''}
      </p>

      <div className="big-sum" aria-live="polite">
        {question.prompt} = ?
      </div>

      <div className="answer-grid">
        {question.choices.map((choice) => (
          <button
            key={choice}
            className={
              verdict && choice === question.answer
                ? 'answer right'
                : verdict === 'wrong'
                  ? 'answer dim'
                  : 'answer'
            }
            onClick={() => answer(choice)}
            disabled={verdict !== null}
          >
            {choice}
          </button>
        ))}
      </div>

      <div style={{ minHeight: '1.6em' }} aria-live="assertive">
        {verdict === 'right' && <strong>Yes! 🎉</strong>}
        {verdict === 'wrong' && (
          <span className="muted">Not quite — it was {question.answer}.</span>
        )}
      </div>
    </div>
  );
}

export function Numbers() {
  return (
    <ActivityShell appId="numbers" title="Number Ninja">
      {(activity) => <NumbersGame activity={activity} />}
    </ActivityShell>
  );
}
