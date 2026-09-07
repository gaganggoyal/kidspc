import { useState } from 'react';
import {
  CONTACT_EMAIL,
  GRIEVANCE_OFFICER,
  PHONE,
  POSTAL_ADDRESS,
  PRODUCT_NAME,
} from '@kidpc/shared';
import { ApiError, api } from '../api';
import { Prose } from './SiteChrome';

/**
 * Contact us.
 *
 * A form rather than only a `mailto:` link. Half the people who would write
 * have no mail client configured on the device they are reading this on -- a
 * television browser has none at all -- and a link that opens nothing reads as
 * a service that does not want to be contacted.
 *
 * The address is shown as well, because some people would rather use their own
 * mail, and because a payment provider's merchant review looks for a plain,
 * readable contact address on the page rather than behind a script.
 */
export function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ message: string }>('/contact', {
        method: 'POST',
        body: { name, email, message },
        as: 'none',
      });
      setSent(result.message);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.userMessage
          : `We could not send that. You can email us directly at ${CONTACT_EMAIL}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Prose
      title="Contact us"
      lede="A person reads every message. Usually a reply within two working days."
    >
      {sent ? (
        <div className="notice" role="status">
          <strong>{sent}</strong>
        </div>
      ) : (
        <form className="contact-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="contact-name">Your name</label>
            <input
              id="contact-name"
              type="text"
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="contact-email">Your email</label>
            <input
              id="contact-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <div className="small muted" style={{ marginTop: 6 }}>
              So we can reply. It is used for nothing else, and we send no marketing email.
            </div>
          </div>

          <div className="field">
            <label htmlFor="contact-message">What would you like to say?</label>
            <textarea
              id="contact-message"
              required
              rows={7}
              minLength={10}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="small muted" style={{ marginTop: 6 }}>
              Please do not include your child&apos;s full name, school or anything else about
              them that we have not asked for.
            </div>
          </div>

          {error && (
            <div className="notice bad" role="alert">
              {error}
            </div>
          )}

          <button className="primary big" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}

      <h2>Or write to us directly</h2>
      <dl className="contact-details">
        <div>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </dd>
        </div>
        {PHONE && (
          <div>
            <dt>Phone</dt>
            <dd>{PHONE}</dd>
          </div>
        )}
        {POSTAL_ADDRESS && (
          <div>
            <dt>Address</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{POSTAL_ADDRESS}</dd>
          </div>
        )}
        <div>
          <dt>Grievance Officer</dt>
          <dd>
            {GRIEVANCE_OFFICER.name} — <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </dd>
        </div>
      </dl>
      <p className="small muted">
        Named under section 13 of the Digital Personal Data Protection Act 2023. If you have asked
        us something about your family&apos;s data and are not satisfied with the answer, write to
        the Grievance Officer and say so — it goes to a person, not a queue.
      </p>

      <h2>What to write about what</h2>
      <ul>
        <li>
          <strong>A child cannot get in</strong> — say which profile and what the screen says. This
          goes to the top of the pile.
        </li>
        <li>
          <strong>Billing</strong> — quote the email address the subscription is under. See also{' '}
          <a href="/refunds">cancellations and refunds</a>.
        </li>
        <li>
          <strong>Your data</strong> — you can export or delete everything yourself, immediately,
          from the parent dashboard. Write to us only if that did not work.
        </li>
        <li>
          <strong>Something about {PRODUCT_NAME} that is wrong</strong> — please do. It is a small
          enough operation that the reply comes from someone who can change it.
        </li>
      </ul>
    </Prose>
  );
}
