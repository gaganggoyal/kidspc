import { useEffect, useState } from 'react';
import type { HomeDto } from '../api';
import { useAutoFocusFirst, useSpatialNavigation } from '../tv';
import { AVATARS } from './Household';

/**
 * A child's first thirty seconds.
 *
 * Deliberately not a tour. A five-year-old will not read three screens of
 * explanation, and a tour teaches nothing that pressing a button would not.
 * So this asks one question -- what shall we do first? -- and turns the answer
 * into an activity immediately. The rest of the launcher is discovered on the
 * way back out, when they already know the computer works.
 *
 * It shows once. `firstRun` comes from the server having no session on record,
 * so it survives a reload and cannot be re-triggered by clearing storage.
 */
const PITCH: Record<string, { glyph: string; line: string }> = {
  paint: { glyph: '🎨', line: 'Draw anything you like' },
  typing: { glyph: '🌱', line: 'Grow a plant with the keyboard' },
  blocks: { glyph: '🤖', line: 'Tell a robot how to get home' },
  numbers: { glyph: '⚡️', line: 'Beat your best at maths' },
  writer: { glyph: '📖', line: 'Write a story of your own' },
  code: { glyph: '💻', line: 'Make a real web page' },
  scratch: { glyph: '🐱', line: 'Build a game in Scratch' },
  gcompris: { glyph: '🧩', line: 'A hundred little games' },
};

export function Welcome({
  home,
  onPick,
  onSkip,
}: {
  home: HomeDto;
  onPick: (appId: string) => void;
  onSkip: () => void;
}) {
  const [shown, setShown] = useState(false);

  useSpatialNavigation();
  useAutoFocusFirst([]);

  // A beat before the cards arrive, so the greeting is read rather than
  // skipped past. Respects reduced-motion via the stylesheet.
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 450);
    return () => clearTimeout(timer);
  }, []);

  // Offer what this child actually has, in an order that puts the most
  // immediately rewarding first. Never more than three: a first choice between
  // eight things is not a choice, it is a wall.
  const preferred = ['paint', 'blocks', 'typing', 'numbers', 'writer', 'code'];
  const picks = home.apps
    .slice()
    .sort((a, b) => {
      const rank = (id: string) => {
        const index = preferred.indexOf(id);
        return index === -1 ? preferred.length : index;
      };
      return rank(a.id) - rank(b.id);
    })
    .slice(0, 3);

  return (
    <div className="tv welcome">
      <div className="welcome-inner">
        <div className="welcome-hello">
          <span className="welcome-avatar" aria-hidden="true">
            {AVATARS[home.child.avatarId] ?? '🦊'}
          </span>
          <h1>Hi {home.child.displayName}!</h1>
          <p className="welcome-sub">
            This is your computer. You have {home.time.remainingMinutes} minutes today.
          </p>
        </div>

        <div className={`welcome-cards ${shown ? 'in' : ''}`}>
          <p className="welcome-prompt">What shall we do first?</p>
          <div className="welcome-grid">
            {picks.map((app) => {
              const pitch = PITCH[app.id] ?? { glyph: '✨', line: app.tagline };
              return (
                <button key={app.id} className="welcome-card" onClick={() => onPick(app.id)}>
                  <span className="glyph" aria-hidden="true">
                    {pitch.glyph}
                  </span>
                  <span className="name">{app.name}</span>
                  <span className="line">{pitch.line}</span>
                </button>
              );
            })}
          </div>

          <button className="welcome-skip" onClick={onSkip}>
            Show me everything instead
          </button>

          <p className="welcome-foot small">
            Press <kbd>←</kbd> <kbd>→</kbd> to move and <kbd>OK</kbd> to choose.
          </p>
        </div>
      </div>
    </div>
  );
}
