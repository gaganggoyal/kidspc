import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EMAIL_CODE_TTL_MINUTES, PRODUCT_NAME } from '@kidpc/shared';
import { ApiError, type GuardianDto, api, setGuardianToken } from '../api';
import { PasswordField } from './PasswordField';

/**
 * Everything to do with the six digits in an emailed letter.
 *
 * The letter carries a code and a button. The code is for the screen that is
 * already open and waiting -- very often a television, where the letter was
 * read on a phone -- and the button is for somebody who reads mail on the same
 * device. Both prove the same thing: this person can read that inbox.
 */
export interface SignedIn {
  guardian: GuardianDto;
  accessToken: string;
  firstTime: boolean;
  needsPassword: boolean;
}

const offline = `We could not reach ${PRODUCT_NAME}. Check your connection and try again.`;
const messageOf = (cause: unknown) => (cause instanceof ApiError ? cause.userMessage : offline);

/**
 * Six digits, and only digits.
 *
 * `one-time-code` lets a phone offer the code from the message it just
 * received, and `numeric` brings up the number pad -- on a TV's on-screen
 * keyboard that is ten keys to move between instead of forty.
 */
export function CodeField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor="code">6-digit code</label>
      <input
        id="code"
        className="code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}

/**
 * "Check your email": type the code, or ask for another.
 *
 * Submits itself on the sixth digit. On a remote, getting from the field to a
 * button is a trip through the on-screen keyboard, and the code being complete
 * is the only signal that was ever going to matter.
 */
export function CodeStep({
  email,
  heading,
  devCode,
  onSignedIn,
  onBack,
}: {
  email: string;
  heading: string;
  /** Development only: the server hands the code back when it has no mailer. */
  devCode?: string;
  onSignedIn: (result: SignedIn) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent'>('idle');
  const tried = useRef<string | null>(null);

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      tried.current = value;
      setBusy(true);
      setError(null);
      try {
        const result = await api<SignedIn>('/auth/email/verify', {
          method: 'POST',
          body: { email, code: value },
          as: 'none',
        });
        setGuardianToken(result.accessToken);
        onSignedIn(result);
      } catch (cause) {
        setError(messageOf(cause));
        setCode('');
      } finally {
        setBusy(false);
      }
    },
    [busy, email, onSignedIn],
  );

  useEffect(() => {
    // Once per code: a rejected code stays rejected until the digits change.
    if (code.length === 6 && tried.current !== code) void submit(code);
  }, [code, submit]);

  const resend = async () => {
    setResent('sending');
    setError(null);
    try {
      await api('/auth/email/code', { method: 'POST', body: { email }, as: 'none' });
      setResent('sent');
    } catch (cause) {
      setError(messageOf(cause));
      setResent('idle');
    }
  };

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <h2>{heading}</h2>
      <p>
        We have sent a 6-digit code to <strong>{email}</strong>. Type it here, or press the button
        in the email on the device you read it on.
      </p>

      {devCode && (
        <div className="notice small">
          Development: no mail is being sent, so here is the code — <strong>{devCode}</strong>
        </div>
      )}

      <CodeField value={code} onChange={setCode} autoFocus />

      {error && (
        <div className="notice bad" role="alert">
          {error}
        </div>
      )}

      <button className="primary" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : 'Continue'}
      </button>

      <p className="small muted" style={{ margin: 0 }}>
        It works for {EMAIL_CODE_TTL_MINUTES} minutes. Nothing arrived? Look in spam, then
      </p>
      <div className="row">
        <button type="button" onClick={() => void resend()} disabled={resent !== 'idle'}>
          {resent === 'sent'
            ? 'Sent — check again'
            : resent === 'sending'
              ? 'Sending…'
              : 'Send a new code'}
        </button>
        <button type="button" onClick={onBack}>
          Use a different email
        </button>
      </div>
    </form>
  );
}

/**
 * The first password, chosen once the address is proved.
 *
 * Skippable. A household that only ever signs in with an emailed code has a
 * perfectly good account; a password is a convenience for a television, where
 * typing ten characters once beats fetching a phone every time.
 */
export function ChoosePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api('/auth/password/set', { method: 'POST', body: { password } });
      onDone();
    } catch (cause) {
      setError(messageOf(cause));
      if (cause instanceof ApiError) setFieldErrors(cause.details as Record<string, string>);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Your email is confirmed</h2>
      <p className="muted">
        Choose a password for signing in on the TV. You can skip this and sign in with an emailed
        code instead.
      </p>
      <PasswordField
        id="password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        autoFocus
        hint="At least 10 characters. Length beats punctuation — you may be typing this on a TV remote."
        error={fieldErrors.password}
      />
      {error && (
        <div className="notice bad" role="alert">
          {error}
        </div>
      )}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </button>
      <button type="button" onClick={onDone}>
        Skip — I will use emailed codes
      </button>
    </form>
  );
}

/**
 * Where the button in a letter lands.
 *
 * One press, not none. A page that spent the token the moment it loaded would
 * be spent by the link scanners some mail services run on every message --
 * they open the link before the parent does -- and the parent would arrive at a
 * button that had already been used. A scanner does not press "Continue".
 */
export function Verify() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);

  const home = () => navigate('/household', { replace: true });

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<SignedIn>('/auth/email/verify', {
        method: 'POST',
        body: { token },
        as: 'none',
      });
      setGuardianToken(result.accessToken);
      if (result.needsPassword) setNeedsPassword(true);
      else home();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tv">
      <div className="page stack narrow">
        <Link to="/" className="small muted back-home">
          ← {PRODUCT_NAME}
        </Link>
        <h1>{PRODUCT_NAME}</h1>
        {needsPassword ? (
          <ChoosePassword onDone={home} />
        ) : !token || error ? (
          <div className="card stack">
            <h2>{token ? 'That button has already been used' : 'That link is incomplete'}</h2>
            <p className="muted">
              {error ??
                'Some mail apps shorten long links. Open it from the message itself, or ask for a code instead.'}
            </p>
            <Link className="btn primary" to="/signin?code=1">
              Email me a new code
            </Link>
          </div>
        ) : (
          <div className="card stack">
            <h2>Confirm and sign in</h2>
            <p className="muted">This signs you in on this device.</p>
            <button className="primary" onClick={() => void confirm()} disabled={busy} autoFocus>
              {busy ? 'Signing in…' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
