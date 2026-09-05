import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, setGuardianToken } from '../api';

/**
 * Guardian sign-in. This is the only place credentials are entered: a child
 * never has a password, and their PIN is only accepted on a device where a
 * guardian is already signed in.
 */
export function SignIn() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
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
        setError('We could not reach KidPC. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 460 }}>
      <h1>KidPC</h1>
      <p className="muted">
        A safe computer for your child, on the screen you already own.
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
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {fieldErrors.email && <div className="error">{fieldErrors.email}</div>}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {mode === 'register' && (
            <div className="small muted" style={{ marginTop: 6 }}>
              At least 10 characters. Length beats punctuation — you may be typing this on a TV remote.
            </div>
          )}
          {fieldErrors.password && <div className="error">{fieldErrors.password}</div>}
        </div>

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
      </form>

      <p className="small muted" style={{ marginTop: 24 }}>
        KidPC does not track children or show them advertising. You can export or delete
        everything we hold at any time from the parent dashboard.
      </p>
    </div>
  );
}
