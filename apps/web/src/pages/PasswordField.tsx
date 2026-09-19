import { useId, useState } from 'react';

/**
 * A password field you can read back.
 *
 * Every screen that asks for one of these is a screen somebody is typing on
 * with a thumb, or with a D-pad and an on-screen keyboard where each character
 * is four presses away. A masked field means a typo is only discovered by a
 * rejection, and on a remote that is a minute of work to repeat.
 *
 * The toggle is a button rather than a checkbox so it can be reached by the
 * same navigation as everything else, and it never persists: the field goes
 * back to masked on the next screen, because the reason for masking -- somebody
 * else in the room -- has not gone away.
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  hint?: string;
  error?: string;
}) {
  const [shown, setShown] = useState(false);
  const hintId = useId();

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          /*
           * A password is never a sentence, and a phone keyboard that
           * capitalises and autocorrects one produces something the person did
           * not type. `type="password"` suppresses this on its own -- and stops
           * doing so the moment the toggle below switches it to `text`.
           */
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={error ? true : undefined}
        />
        <button
          type="button"
          className="password-reveal"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          /* The label says what pressing it does, not what state it is in;
             `aria-pressed` carries the state. */
          aria-label={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && (
        <div className="small muted" id={hintId} style={{ marginTop: 6 }}>
          {hint}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
