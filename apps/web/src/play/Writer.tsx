import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';

/**
 * Story Writer.
 *
 * What a child writes stays on their device. The server learns how many words
 * they wrote and nothing else -- storing children's own prose would turn a
 * homework tool into a repository of their private expression, which is a much
 * heavier thing to hold and is not needed to show they are learning.
 */
const STORAGE_KEY = 'kidpc.writer.v1';
const PROMPTS = [
  'The day my bicycle learned to talk',
  'A letter to someone a hundred years from now',
  'What I would do with one extra hour every day',
  'The best thing about my street',
  'If I could invent one new animal',
];

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function WriterPad({ activity }: { activity: ActivityApi }) {
  const [text, setText] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [prompt, setPrompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!);
  const reported = useRef(0);

  useEffect(() => {
    try {
      setText(localStorage.getItem(STORAGE_KEY) ?? '');
    } catch {
      // Storage unavailable. Start blank rather than refusing to open.
    }
  }, []);

  const save = useCallback(
    (value: string) => {
      try {
        localStorage.setItem(STORAGE_KEY, value);
        setSavedAt(new Date());
      } catch {
        // Losing an autosave is bad but silently. Never block typing on it.
      }
      const words = countWords(value);
      // Report at milestones, not on every keystroke.
      if (words >= reported.current + 25) {
        reported.current = words;
        activity.report('words_written', words);
      }
    },
    [activity],
  );

  // Debounced autosave: a child should never have to think about saving, and
  // writing to storage on every keystroke makes a slow TV browser stutter.
  useEffect(() => {
    const timer = setTimeout(() => save(text), 800);
    return () => clearTimeout(timer);
  }, [text, save]);

  const words = countWords(text);

  return (
    <div className="writer-layout">
      <div className="spread">
        <div>
          <strong>Try writing about:</strong>{' '}
          <span className="muted">{prompt}</span>
        </div>
        <div className="row">
          <button
            onClick={() => setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!)}
          >
            Another idea
          </button>
        </div>
      </div>

      <textarea
        className="writer-pad"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing…"
        aria-label="Your writing"
        spellCheck
      />

      <div className="spread small muted">
        <span>
          {words} word{words === 1 ? '' : 's'}
          {activity.best('words_written') ? ` · best ${activity.best('words_written')}` : ''}
        </span>
        <span>
          {savedAt
            ? `Saved on this device at ${savedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
            : 'Saves automatically'}
        </span>
      </div>
    </div>
  );
}

export function Writer() {
  return (
    <ActivityShell appId="writer" title="Story Writer">
      {(activity) => <WriterPad activity={activity} />}
    </ActivityShell>
  );
}
