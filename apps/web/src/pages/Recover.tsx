import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PASSWORD_RESET_TTL_MINUTES, PRODUCT_NAME } from '@kidpc/shared';
import { ApiError, api, setGuardianToken } from '../api';
import { PasswordField } from './PasswordField';

/**
 * Getting back in.
 *
 * Two screens rather than one component each, because they are two halves of
 * the same journey and the copy on the second only makes sense in the light of
 * the first. A household that lands on `/reset` with no token in the URL has
 * clicked a mangled link, and the right thing to show them is the form that
 * sends a new one -- which is this file's other half.
 *
 * Neither screen is in the `.tv` scope. Recovery happens on the device where
 * the mail is, which is a phone in every household we have watched, and a
 * password typed on a TV remote is a password typed once.
 */
export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email }, as: 'none' });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.userMessage
          : `We could not reach ${PRODUCT_NAME}. Check your connection and try again.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Forgotten password">
      {sent ? (
        <div className="card stack">
          <h2>Check your email</h2>
          {/*
            * Careful wording, on purpose. The server answers identically
            * whether or not the address is registered -- otherwise this form
            * is a way for anybody to find out which parents have an account --
            * so this screen must not claim a message was sent.
            */}
          <p>
            If <strong>{email}</strong> has an account, a link to choose a new password is on its
            way. It works once and stops working after {PASSWORD_RESET_TTL_MINUTES} minutes.
          </p>
          <p className="small muted">
            Nothing in your household changes in the meantime — your children&apos;s profiles,
            limits and progress are exactly as you left them.
          </p>
          <div className="row">
            <Link className="btn" to="/signin">
              Back to sign in
            </Link>
            <button type="button" onClick={() => setSent(false)}>
              Try another address
            </button>
          </div>
        </div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <h2>Forgotten your password?</h2>
          <p className="muted">
            Tell us the address you signed up with and we will send you a link to choose a new one.
          </p>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              {...EMAIL_INPUT}
            />
          </div>

          {error && (
            <div className="notice bad" role="alert">
              {error}
            </div>
          )}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a link'}
          </button>
          <Link className="small muted" to="/signin">
            ← Back to sign in
          </Link>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api<{ accessToken: string }>('/auth/password/reset', {
        method: 'POST',
        body: { token, password },
        as: 'none',
      });
      // Signed in rather than sent back to the sign-in form: they have just
      // proved they own the account, and asking them to type the password they
      // chose four seconds ago is a screen that exists for nobody.
      setGuardianToken(result.accessToken);
      navigate('/household', { replace: true });
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

  // A link that arrived broken, or a bookmark of this page. Same destination
  // as an expired one, because from here they are the same problem.
  if (!token) {
    return (
      <Shell title="Choose a new password">
        <div className="card stack">
          <h2>That link is incomplete</h2>
          <p className="muted">
            Some mail apps shorten long links. Ask for a fresh one and open it from the message
            itself rather than copying it.
          </p>
          <Link className="btn primary" to="/forgot">
            Send me a new link
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      <form className="card stack" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <p className="muted">
          Every device signed in to this household will be signed out, including any you have
          forgotten about.
        </p>

        <PasswordField
          id="password"
          label="New password"
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
            {/* The one thing that helps when a link has expired. */}
            <div style={{ marginTop: 10 }}>
              <Link className="btn" to="/forgot">
                Send me a new link
              </Link>
            </div>
          </div>
        )}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save and sign in'}
        </button>
      </form>
    </Shell>
  );
}

/** The frame both halves share: the product name, the form, the promise. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="page stack narrow">
      <Link to="/" className="small muted back-home">
        ← {PRODUCT_NAME}
      </Link>
      <h1>{title}</h1>
      {children}
      <p className="small muted">
        {PRODUCT_NAME} does not track children or show them advertising.
      </p>
    </div>
  );
}

/**
 * What a phone keyboard should do with an address.
 *
 * Without these an iOS keyboard capitalises the first letter and autocorrects
 * the domain, so a parent types their address correctly and the field holds
 * something else. Shared rather than repeated because it was already wrong in
 * one of the two places it appeared.
 */
export const EMAIL_INPUT = {
  autoComplete: 'email',
  inputMode: 'email' as const,
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
};
