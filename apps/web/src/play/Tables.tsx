import { useCallback, useEffect, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';
import { useAutoFocusFirst } from '../tv';
import { shuffle } from './random';

/**
 * Times Tables.
 *
 * Number Ninja already asks arithmetic, and deliberately mixes it up. This does
 * the opposite: one table at a time, to the point of boredom, because that is
 * what committing a multiplication fact to memory actually takes and there is
 * no version of it that is a surprise every time.
 *
 * The grid is the reason this exists as its own activity rather than a mode of
 * another one. A child filling in squares can see the shape of what they know,
 * and so can whoever they show it to -- which is the only part of drilling
 * tables that has ever motivated anybody. It resets every session on purpose:
 * it is a picture of this sitting, not a permanent record of a child's gaps.
 */
const TABLES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const UP_TO = 12;

interface Question {
  a: number;
  b: number;
  answer: number;
  choices: number[];
}

export function ask(table: number | 'mixed'): Question {
  const a = table === 'mixed' ? TABLES[Math.floor(Math.random() * TABLES.length)]! : table;
  // From two, not one. Multiplying by one is not a fact anybody has to learn,
  // and it is the case where every plausible distractor collapses into the
  // counting numbers: 2 x 1 offered as 1, 2, 3, 4 is not a question about the
  // two times table.
  const b = 2 + Math.floor(Math.random() * (UP_TO - 1));
  const answer = a * b;

  /*
   * Distractors are other products, in preference order.
   *
   * The obvious implementation -- answer plus or minus one or two -- makes the
   * 2x table unanswerable: 2 x 9 offered as 16, 17, 18, 19 is four consecutive
   * numbers, and a child who does not know the fact cannot reason their way to
   * it, so the question stops testing the table and starts testing luck. Every
   * candidate here is a product a child might genuinely land on: the multiple
   * either side, the same position in the table either side, and the digits
   * swapped, which is the classic slip on 12 x 3.
   */
  const swapped = Number([...String(answer)].reverse().join(''));
  const candidates = [
    a * (b + 1),
    a * (b - 1),
    (a + 1) * b,
    (a - 1) * b,
    a * (b + 2),
    a * (b - 2),
    swapped,
  ];

  const choices: number[] = [];
  for (const n of candidates) {
    if (n > 0 && n !== answer && !choices.includes(n)) choices.push(n);
    if (choices.length === 3) break;
  }
  return { a, b, answer, choices: shuffle([answer, ...choices]) };
}

const cellKey = (a: number, b: number) => `${a}x${b}`;

export function TablesGame({ activity }: { activity: ActivityApi }) {
  const [table, setTable] = useState<number | 'mixed'>(2);
  const [question, setQuestion] = useState<Question>(() => ask(2));
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [right, setRight] = useState(0);
  const [asked, setAsked] = useState(0);

  useAutoFocusFirst([question]);

  const next = useCallback((forTable: number | 'mixed') => {
    setQuestion(ask(forTable));
    setVerdict(null);
  }, []);

  useEffect(() => {
    next(table);
  }, [table, next]);

  const answer = (choice: number) => {
    if (verdict) return;
    const askedNow = asked + 1;
    setAsked(askedNow);
    if (choice === question.answer) {
      const rightNow = right + 1;
      setRight(rightNow);
      setVerdict('right');
      setKnown((current) => new Set(current).add(cellKey(question.a, question.b)));
      activity.report('puzzles_solved', rightNow);
      activity.report('accuracy_pct', Math.round((rightNow / askedNow) * 100));
      if (typeof table === 'number') activity.report('level', table);
    } else {
      setVerdict('wrong');
    }
  };

  useEffect(() => {
    if (!verdict) return;
    const timer = setTimeout(() => next(table), verdict === 'right' ? 520 : 1200);
    return () => clearTimeout(timer);
  }, [verdict, table, next]);

  const accuracy = asked > 0 ? Math.round((right / asked) * 100) : 100;
  const best = activity.best('puzzles_solved');

  return (
    <div className="play-stage">
      <div className="chips" role="group" aria-label="Which table">
        {TABLES.map((t) => (
          <button key={t} className="chip" aria-pressed={table === t} onClick={() => setTable(t)}>
            {t}×
          </button>
        ))}
        <button className="chip" aria-pressed={table === 'mixed'} onClick={() => setTable('mixed')}>
          mixed
        </button>
      </div>

      <p className="muted" style={{ margin: 0 }}>
        {right} right{asked > 0 ? ` · ${accuracy}% today` : ''}
        {best !== null && best > right ? ` · best ${best}` : ''}
      </p>

      <div className="big-sum" aria-live="polite">
        {question.a} × {question.b} = ?
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
          <span className="muted">
            {question.a} × {question.b} is {question.answer}.
          </span>
        )}
      </div>

      {/*
        * Only the table being practised, unless the child has chosen mixed.
        *
        * The full eleven rows looked better in a stylesheet and worse on a
        * screen: a child drilling the 2x table faced a hundred and thirty-two
        * squares, of which at most twelve could ever fill in this session. A
        * picture of everything you have not done is the kind of quiet scorekeeping
        * the weekly challenge deliberately refuses, and it does not belong here
        * either.
        */}
      <div className="tables-map" aria-label="Facts you have got right this session">
        {(table === 'mixed' ? TABLES : [table]).map((a) => (
          <div className="tables-row" key={a}>
            <span className="tables-label">{a}×</span>
            {Array.from({ length: UP_TO }, (_, i) => i + 1).map((b) => (
              <span
                key={b}
                className={`tables-cell ${known.has(cellKey(a, b)) ? 'got' : ''}`}
                title={`${a} × ${b}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Tables() {
  return (
    <ActivityShell appId="tables" title="Times Tables">
      {(activity) => <TablesGame activity={activity} />}
    </ActivityShell>
  );
}
