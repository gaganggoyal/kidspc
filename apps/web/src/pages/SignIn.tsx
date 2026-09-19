import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@kidpc/shared';
import { ApiError, api, setGuardianToken } from '../api';
import { EMAIL_INPUT } from './Recover';
import { PasswordField } from './PasswordField';

/**
 * Guardian sign-in. This is the only place credentials are entered: a child
 * never has a password, and their PIN is only accepted on a device where a
 * guardian is already signed in.
 */
export function SignIn() {
  const navigate = useNavigate();
  // The home page's primary call to action is "create an account", so it links
  // here with ?new=1 rather than dropping a first-time visitor on a form that
  // asks for a password they have not chosen yet.
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'register'>(
    params.get('new') ? 'register' : 'signin',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const path = mode === 'signin' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'signin'
          ? { email, password }
          : { email, password, displayName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      const result = await api<{ accessToken: string }>(path, { method: 'POST', body, as: 'none' });
      setGuardianToken(result.accessToken);
      navigate('/household');
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.userMessage);
        setFieldErrors(cause.details as Record<string, string>);
      } else {
        setError(`We could not reach ${PRODUCT_NAME}. Check your connection and try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    /*
     * `.tv` because this is very often the first thing a television shows: a
     * set navigated by a D-pad gets the across-the-room scale here as it does
     * everywhere else, and a phone or a laptop gets its own. It was the one
     * screen in the signed-in flow without the class, so the hardest text in
     * the product to read and the hardest field to type into were rendered at
     * the laptop scale on a set across the room.
     */
    <div className="tv">
    <div className="page stack narrow">
      <Link to="/" className="small muted back-home">
        ← {PRODUCT_NAME}
      </Link>
      <h1>{PRODUCT_NAME}</h1>
      <p className="muted">
        {PRODUCT_TAGLINE}
      </p>

      <form className="card stack" onSubmit={submit}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create a parent account'}</h2>

        {mode === 'register' && (
          <div className="field">
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            {...EMAIL_INPUT}
          />
          {fieldErrors.email && <div className="error">{fieldErrors.email}</div>}
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          hint={
            mode === 'register'
              ? 'At least 10 characters. Length beats punctuation — you may be typing this on a TV remote.'
              : undefined
          }
          error={fieldErrors.password}
        />

        {error && (
          <div className="notice bad" role="alert">
            {error}
          </div>
        )}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin');
            setError(null);
            setFieldErrors({});
          }}
        >
          {mode === 'signin' ? 'I need an account' : 'I already have an account'}
        </button>

        {/*
          * Only on the sign-in half. Offering to reset a password on the form
          * that creates one reads as though something has already gone wrong.
          */}
        {mode === 'signin' && (
          <Link className="small muted" to="/forgot">
            I have forgotten my password
          </Link>
        )}
      </form>

      <p className="small muted">
        {PRODUCT_NAME} does not track children or show them advertising. You can export or
        delete everything we hold at any time from the parent dashboard.
      </p>
    </div>
    </div>
  );
}
