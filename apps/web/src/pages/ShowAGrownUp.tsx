import { useEffect, useRef, useState } from 'react';
import {
  PRODUCT_NAME,
  type Challenge,
  REFERRAL_BONUS_DAYS,
  TRIAL_DAYS,
  referralLink,
  whatsappShareUrl,
} from '@kidpc/shared';

export interface Achievement {
  label: string;
  value: string;
}

/**
 * "Show a grown-up."
 *
 * This is the only thing in the product that is designed to leave the house,
 * and every constraint on it follows from who is allowed to do the leaving.
 *
 * A child may not share anything with anyone. Not to another child, not to a
 * feed, not to us. DPDP 2023 s.9 rules out the tracking that a social feature
 * would need, and safeguarding rules out the feature itself. So the child's
 * half of this is a button that opens a card on their own screen and calls a
 * grown-up over. The grown-up's half is a share sheet on their own phone, with
 * text they can read before they send it, going to people they chose.
 *
 * Nothing is uploaded at any point. The card is assembled in the browser from
 * numbers the browser already has, the share text is a string handed to the
 * operating system, and if nobody presses anything then nothing happens and we
 * never learn that the card was opened. That is not a limitation we are working
 * around -- it is the reason a parent is willing to press share at all.
 */
export function ShowAGrownUp({
  open,
  onClose,
  challenge,
  achievements,
  childName,
  askForName = false,
  referralCode,
}: {
  open: boolean;
  onClose: () => void;
  challenge: Challenge;
  achievements: readonly Achievement[];
  childName?: string | null;
  /** The preview has no account, so it offers a name field. Stays on-device. */
  askForName?: boolean;
  /** Present only for a signed-in parent; the preview shares a plain link. */
  referralCode?: string | null;
}) {
  const [name, setName] = useState(childName ?? '');
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const origin = window.location.origin;
  const who = name.trim();
  const link = referralCode ? referralLink(origin, referralCode) : origin;

  const shareText = [
    who ? `${who} made this on ${PRODUCT_NAME} today.` : `Made on ${PRODUCT_NAME} today.`,
    `This week's challenge: ${challenge.title} — ${challenge.prompt}`,
    ...achievements.map((a) => `${a.label}: ${a.value}`),
    '',
    referralCode
      ? `Free to try, and this link gives you ${TRIAL_DAYS + REFERRAL_BONUS_DAYS} days instead of ${TRIAL_DAYS}: ${link}`
      : `Free to try, no account needed: ${link}`,
  ]
    .filter(Boolean)
    .join('\n');

  const share = async () => {
    // The Web Share API is the right thing on the phones this actually happens
    // on. `navigator.share` rejects with AbortError when the sheet is
    // dismissed, which is a person changing their mind rather than a failure.
    if (navigator.share) {
      try {
        await navigator.share({ title: PRODUCT_NAME, text: shareText });
        return;
      } catch {
        return;
      }
    }
    window.open(whatsappShareUrl(shareText), '_blank', 'noopener,noreferrer');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Show a grown-up">
      <div className="sheet">
        <div className="certificate" id="certificate">
          <p className="cert-eyebrow">{PRODUCT_NAME}</p>
          <h2 className="cert-title">
            {who ? `${who} made something` : 'Something got made'}
          </h2>
          <p className="cert-date">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>

          <div className="cert-challenge">
            <span className="cert-label">This week&apos;s challenge</span>
            <strong>{challenge.title}</strong>
            <p className="muted small">{challenge.prompt}</p>
          </div>

          {achievements.length > 0 && (
            <dl className="cert-stats">
              {achievements.map((a) => (
                <div key={a.label}>
                  <dt>{a.label}</dt>
                  <dd>{a.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <p className="cert-note">{challenge.grownUp}</p>
        </div>

        <div className="sheet-actions no-print">
          {askForName && (
            <div className="field">
              <label htmlFor="cert-name">Your first name</label>
              <input
                id="cert-name"
                type="text"
                maxLength={24}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
              />
              <div className="small muted" style={{ marginTop: 6 }}>
                Typed here and nowhere else. It is not sent to us — it only goes into the card
                above, on this screen.
              </div>
            </div>
          )}

          <div className="row">
            <button className="primary" onClick={() => void share()}>
              Share with family
            </button>
            <button onClick={() => window.print()}>Print</button>
            <button onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy the words'}</button>
            <button ref={closeRef} onClick={onClose}>
              Close
            </button>
          </div>

          <p className="small muted" style={{ margin: 0 }}>
            Nothing has been uploaded. The card was made on this device, and sharing it opens your
            own phone&apos;s share sheet — you choose who sees it, and you can read it first.
          </p>
        </div>
      </div>
    </div>
  );
}
