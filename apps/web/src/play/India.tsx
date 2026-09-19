import { useCallback, useEffect, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';
import { useAutoFocusFirst } from '../tv';
import { useChoiceKeys } from '../input';
import { pick, shuffle } from './random';

/**
 * Know India.
 *
 * The rest of this catalogue could have been built for a child anywhere. This
 * one could not, and that is deliberate: a product sold to Indian households
 * whose entire idea of learning is spelled in American words has told the
 * parent something about itself before they have read a single feature.
 *
 * It also happens to be syllabus. States and capitals sit in class 4-5 social
 * studies, which means this is the one activity here a parent can point at and
 * say it is helping with school without having to take anyone's word for it.
 *
 * Two facts per state, at most, and both are the kind printed in a textbook.
 * Nothing here is an opinion about a place.
 */
interface State {
  name: string;
  capital: string;
  /** One thing a child would recognise, and where it is. */
  landmark?: string;
  glyph?: string;
}

const STATES: State[] = [
  { name: 'Andhra Pradesh', capital: 'Amaravati' },
  { name: 'Arunachal Pradesh', capital: 'Itanagar' },
  { name: 'Assam', capital: 'Dispur', landmark: 'Kaziranga, where the one-horned rhinos live', glyph: '🦏' },
  { name: 'Bihar', capital: 'Patna', landmark: 'Nalanda, one of the oldest universities on earth', glyph: '📜' },
  { name: 'Chhattisgarh', capital: 'Raipur' },
  { name: 'Goa', capital: 'Panaji', landmark: 'The Basilica of Bom Jesus', glyph: '⛪' },
  { name: 'Gujarat', capital: 'Gandhinagar', landmark: 'The white salt desert of the Rann of Kutch', glyph: '🏜️' },
  { name: 'Haryana', capital: 'Chandigarh' },
  { name: 'Himachal Pradesh', capital: 'Shimla', landmark: 'The toy train that climbs to Shimla', glyph: '🚂' },
  { name: 'Jharkhand', capital: 'Ranchi' },
  { name: 'Karnataka', capital: 'Bengaluru', landmark: 'Mysore Palace', glyph: '🏰' },
  { name: 'Kerala', capital: 'Thiruvananthapuram', landmark: 'The backwaters and their houseboats', glyph: '🛶' },
  { name: 'Madhya Pradesh', capital: 'Bhopal', landmark: 'The Sanchi Stupa', glyph: '🛕' },
  { name: 'Maharashtra', capital: 'Mumbai', landmark: 'The Gateway of India', glyph: '🏛️' },
  { name: 'Manipur', capital: 'Imphal', landmark: 'Loktak, the lake with floating islands', glyph: '🏞️' },
  { name: 'Meghalaya', capital: 'Shillong', landmark: 'Living root bridges grown from trees', glyph: '🌳' },
  { name: 'Mizoram', capital: 'Aizawl' },
  { name: 'Nagaland', capital: 'Kohima' },
  { name: 'Odisha', capital: 'Bhubaneswar', landmark: 'The Sun Temple at Konark', glyph: '☀️' },
  { name: 'Punjab', capital: 'Chandigarh', landmark: 'The Golden Temple at Amritsar', glyph: '🕌' },
  { name: 'Rajasthan', capital: 'Jaipur', landmark: 'Hawa Mahal, the palace of winds', glyph: '🏯' },
  { name: 'Sikkim', capital: 'Gangtok', landmark: 'Kanchenjunga, the highest peak in India', glyph: '🏔️' },
  { name: 'Tamil Nadu', capital: 'Chennai', landmark: 'The Meenakshi Temple at Madurai', glyph: '🛕' },
  { name: 'Telangana', capital: 'Hyderabad', landmark: 'The Charminar', glyph: '🕌' },
  { name: 'Tripura', capital: 'Agartala' },
  { name: 'Uttar Pradesh', capital: 'Lucknow', landmark: 'The Taj Mahal at Agra', glyph: '🕌' },
  { name: 'Uttarakhand', capital: 'Dehradun', landmark: 'The Valley of Flowers', glyph: '🌸' },
  { name: 'West Bengal', capital: 'Kolkata', landmark: 'The Sundarbans, home of the tiger', glyph: '🐅' },
];

const WITH_LANDMARK = STATES.filter((s) => s.landmark);

interface Question {
  kind: 'capital' | 'landmark';
  prompt: string;
  glyph: string;
  answer: string;
  choices: string[];
  note: string;
}

/**
 * Four choices, deduplicated by the *answer text*.
 *
 * Chandigarh is the capital of both Punjab and Haryana, so drawing distractors
 * by picking other states can put the correct answer on the board twice. A
 * child who picks the second Chandigarh has answered correctly and been told
 * they are wrong, which is the worst thing a quiz can do.
 */
function build(): Question {
  const kind: Question['kind'] = Math.random() < 0.5 ? 'capital' : 'landmark';

  if (kind === 'capital') {
    const state = pick(STATES);
    const pool = STATES.map((s) => s.capital).filter((c) => c !== state.capital);
    const choices = shuffle([state.capital, ...shuffle([...new Set(pool)]).slice(0, 3)]);
    return {
      kind,
      prompt: `What is the capital of ${state.name}?`,
      glyph: '🇮🇳',
      answer: state.capital,
      choices,
      note: `${state.capital} is the capital of ${state.name}.`,
    };
  }

  const state = pick(WITH_LANDMARK);
  const pool = STATES.map((s) => s.name).filter((n) => n !== state.name);
  const choices = shuffle([state.name, ...shuffle([...new Set(pool)]).slice(0, 3)]);
  return {
    kind,
    prompt: `Which state would you go to for ${state.landmark}?`,
    glyph: state.glyph ?? '📍',
    answer: state.name,
    choices,
    note: `You would find it in ${state.name}.`,
  };
}

export function IndiaGame({ activity }: { activity: ActivityApi }) {
  const [question, setQuestion] = useState<Question>(() => build());
  const [verdict, setVerdict] = useState<'right' | 'wrong' | null>(null);
  const [right, setRight] = useState(0);
  const [asked, setAsked] = useState(0);

  useAutoFocusFirst([question]);

  const next = useCallback(() => {
    setQuestion(build());
    setVerdict(null);
  }, []);

  const answer = useCallback(
    (choice: string) => {
      if (verdict) return;
      const askedNow = asked + 1;
      setAsked(askedNow);
      if (choice === question.answer) {
        const rightNow = right + 1;
        setRight(rightNow);
        setVerdict('right');
        activity.report('puzzles_solved', rightNow);
        activity.report('accuracy_pct', Math.round((rightNow / askedNow) * 100));
      } else {
        setVerdict('wrong');
      }
    },
    [verdict, asked, right, question.answer, activity],
  );

  /*
   * 1 to 4 answer the question, for a keyboard plugged into the television.
   * The hint on each button appears only once a keyboard has been used; see
   * input.ts.
   */
  const chooseByKey = useCallback(
    (index: number) => answer(question.choices[index]!),
    [answer, question.choices],
  );
  useChoiceKeys(chooseByKey, question.choices.length, verdict === null);

  useEffect(() => {
    if (!verdict) return;
    const timer = setTimeout(next, verdict === 'right' ? 900 : 1900);
    return () => clearTimeout(timer);
  }, [verdict, next]);

  const best = activity.best('puzzles_solved');

  return (
    <div className="play-stage">
      <p className="muted" style={{ margin: 0 }}>
        {right} right{asked > 0 ? ` of ${asked}` : ''}
        {best !== null && best > right ? ` · best ${best}` : ''}
      </p>

      <div className="play-glyph small" aria-hidden="true">
        {question.glyph}
      </div>

      <h2 className="india-prompt" aria-live="polite">
        {question.prompt}
      </h2>

      <div className="answer-grid wide">
        {question.choices.map((choice, index) => (
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
            <kbd className="key-hint">{index + 1}</kbd>
          </button>
        ))}
      </div>

      <div style={{ minHeight: '2.4em' }} aria-live="assertive">
        {verdict === 'right' && <strong>Yes! 🎉</strong>}
        {verdict === 'wrong' && <span className="muted">{question.note}</span>}
      </div>
    </div>
  );
}

export function India() {
  return (
    <ActivityShell appId="india" title="Know India">
      {(activity) => <IndiaGame activity={activity} />}
    </ActivityShell>
  );
}
