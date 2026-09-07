import { useState } from 'react';
import {
  MAX_CHILDREN,
  type Plan,
  formatInr,
  monthlyPriceInr,
  trialDaysFor,
} from '@kidpc/shared';
import { ApiError, api } from '../api';
import { currentReferral } from '../referral';

/**
 * Asking to subscribe.
 *
 * There is no checkout, because there is no payment provider. What this does is
 * take an email and a household size and promise a payment link by email --
 * which is the truth, and is also the thing that lets a household commit to a
 * price before we can charge for it.
 *
 * It asks for the least it can: an address to reply to, optionally a name, and
 * how many children. No card, no address, no phone number. Anything more would
 * be collected on the strength of a promise we have not yet kept.
 */
export function PlanRequest({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [children, setChildren] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    quotedInr: number;
    message: string;
    trialDays: number;
  } | null>(null);

  // Whoever sent them, remembered from the ?ref= on the link they followed.
  // Read once at render rather than at submit, so the extra free days are
  // promised on the form before anyone commits to anything.
  const referralCode = currentReferral();
  const trialDays = trialDaysFor(plan, { referred: Boolean(referralCode) });

  // Shown live as the household size changes, and computed from the same
  // function the server prices with -- so the figure on screen is the figure in
  // the confirmation email rather than a second implementation of the rules.
  const quoted = monthlyPriceInr(plan, children);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ quotedInr: number; message: string; trialDays: number }>(
        '/orders',
        {
          method: 'POST',
          body: {
            email,
            contactName: contactName || undefined,
            planId: plan.id,
            children,
            referralCode: referralCode ?? undefined,
          },
          as: 'none',
        },
      );
      setDone(result);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.userMessage
          : 'We could not send that. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="request-panel" role="status">
        <h3>Request received</h3>
        {/* The server's words, not ours: one promise, written once. */}
        <p>{done.message}</p>
        <p className="small muted">
          {plan.name}, {children} {children === 1 ? 'child' : 'children'} —{' '}
          {formatInr(done.quotedInr)} per month
          {done.trialDays > 0 ? ` after your ${done.trialDays} free days` : ', from the first month'}
          .
        </p>
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <form className="request-panel" onSubmit={submit}>
      <h3>
        {plan.name} — {formatInr(quoted)}
        <span className="muted"> / month</span>
      </h3>
      <p className="small muted">
        We will email you a payment link. Nothing is charged now, and we do not ask for card
        details.
      </p>

      {referralCode && trialDays > 0 && (
        <p className="small referred-note">
          Someone sent you here ({referralCode}), so your first {trialDays} days are free instead
          of {plan.trialDays}.
        </p>
      )}

      {plan.trialDays === 0 && (
        <p className="small muted">
          {plan.name} has no free trial — it runs a real computer on our hardware, so it is billed
          from the first month. {plan.name === 'Pro' ? 'Lite is the free way to find out whether your household will use this.' : ''}
        </p>
      )}

      <div className="field">
        <label htmlFor="order-email">Your email</label>
        <input
          id="order-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="order-name">Your name (optional)</label>
        <input
          id="order-name"
          type="text"
          autoComplete="name"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="order-children">How many children?</label>
        <select
          id="order-children"
          value={children}
          onChange={(e) => setChildren(Number(e.target.value))}
        >
          {Array.from({ length: MAX_CHILDREN }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'child' : 'children'}
              {n > plan.includedChildren ? ` — ${formatInr(monthlyPriceInr(plan, n))}/month` : ''}
            </option>
          ))}
        </select>
        <div className="small muted" style={{ marginTop: 6 }}>
          Up to {plan.includedChildren} children are included. Each additional child is half price.
        </div>
      </div>

      {error && (
        <div className="notice bad" role="alert">
          {error}
        </div>
      )}

      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Request payment link'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
