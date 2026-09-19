import { useState } from 'react';
import { getScreenMode, setScreenMode, type ScreenMode } from '../display';

/**
 * Text size, chosen by whoever is looking at it.
 *
 * Sits on the two screens a television is set up from -- the parent's sign-in
 * and the profile picker -- and nowhere else. It is a property of the device,
 * settled once, and putting it in front of a child mid-activity would be
 * clutter on every screen to solve a problem that occurs on one.
 *
 * "Auto" rather than "Normal" because that is what it does: the automatic size
 * is right on a phone and on a laptop and on the televisions we can actually
 * identify. This is the escape hatch for the ones we cannot.
 */
const OPTIONS: Array<{ id: ScreenMode; label: string; hint: string }> = [
  { id: 'auto', label: 'Auto', hint: 'Sized for this device' },
  { id: 'big', label: 'Bigger', hint: 'For a television across the room' },
];

export function ScreenSize() {
  const [mode, setMode] = useState<ScreenMode>(getScreenMode);

  return (
    <div className="screen-size">
      <span className="small muted">Text size</span>
      <div className="chips" role="group" aria-label="Text size">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            className="chip"
            aria-pressed={mode === option.id}
            title={option.hint}
            onClick={() => {
              setScreenMode(option.id);
              setMode(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
