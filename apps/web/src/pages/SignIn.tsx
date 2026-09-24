import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@kidpc/shared';
import { ApiError, api, setGuardianToken } from '../api';
import { ChoosePassword, CodeStep, type SignedIn } from './EmailCode';
import { EMAIL_INPUT } from './Recover';
import { PasswordField } from './PasswordField';

/**
 * Guardian sign-in. This is the only place credentials are entered: a child
 * never has a password, and their PIN is only accepted on a device where a
 * guardian is already signed in.
 *
 * Three ways in, all ending in the same place:
 *
 *   - a password, for the TV that is signed in once and left;
 *   - an emailed code, for somebody who never chose a password or forgot it;
 *   - a new account, which is a name and an address -- the address is proved
 *     with a code before anything else happens, and the password comes after.
 */
type Mode = 'signin' | 'register' | 'code';
type Step =
  | { kind: 'form' }
  | { kind: 'code'; heading: string; devCode?: string }
  | { kind: 'password' };

export function SignIn() {
  const navigate = useNavigate();
  // The home page's primary call to action is "create an account", so it links
  // here with ?new=1 rather than dropping a first-time visitor on a form that
  // asks for a password they have not chosen yet. A spent emailed button sends
  // people back with ?code=1, to ask for a fresh code.
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get('new') ? 'register' : params.get('code') ? 'code' : 'signin',
  );
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const home = useCallback(() => navigate('/household'), [navigate]);
  const signedIn = useCallback(
    (result: SignedIn) => (result.needsPassword ? setStep({ kind: 'password' }) : home()),
    [home],
  );

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setFieldErrors({});
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (mode === 'signin') {
        const result = await api<{ accessToken: string }>('/auth/login', {
          method: 'POST',
          body: { email, password },
          as: 'none',
        });
        setGuardianToken(result.accessToken);
        home();
      } else if (mode === 'register') {
        const result = await api<{ devCode?: string }>('/auth/register', {
          method: 'POST',
          body: { email, displayName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          as: 'none',
        });
        setStep({ kind: 'code', heading: 'Confirm your email', devCode: result.devCode });
      } else {
        await api('/auth/email/code', { method: 'POST', body: { email }, as: 'none' });
        setStep({ kind: 'code', heading: 'Check your email' });
      }
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

  const title = { signin: 'Sign in', register: 'Create a parent account', code: 'Sign in with a code' }[
    mode
  ];
  const action = { signin: 'Sign in', register: 'Send me a code', code: 'Email me a code' }[mode];

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

      {step.kind === 'code' ? (
        <CodeStep
          email={email}
          heading={step.heading}
          devCode={step.devCode}
          onSignedIn={signedIn}
          onBack={() => setStep({ kind: 'form' })}
        />
      ) : step.kind === 'password' ? (
        <ChoosePassword onDone={home} />
      ) : (
        <form className="card stack" onSubmit={submit}>
          <h2>{title}</h2>

          {mode === 'register' && (
            <>
              <p className="muted">
                Your name and email. We send a code to confirm the address, then you choose a
                password.
              </p>
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
            </>
          )}
          {mode === 'code' && (
            <p className="muted">We will email you a 6-digit code. No password needed.</p>
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

          {mode === 'signin' && (
            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              error={fieldErrors.password}
            />
          )}

          {error && (
            <div className="notice bad" role="alert">
              {error}
            </div>
          )}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : action}
          </button>

          {mode === 'signin' && (
            <button type="button" onClick={() => switchTo('code')}>
              Email me a code instead
            </button>
          )}
          {mode === 'code' && (
            <button type="button" onClick={() => switchTo('signin')}>
              Use my password instead
            </button>
          )}
          <button type="button" onClick={() => switchTo(mode === 'register' ? 'signin' : 'register')}>
            {mode === 'register' ? 'I already have an account' : 'I need an account'}
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
      )}

      <p className="small muted">
        {PRODUCT_NAME} does not track children or show them advertising. You can export or
        delete everything we hold at any time from the parent dashboard.
      </p>
    </div>
    </div>
  );
}
