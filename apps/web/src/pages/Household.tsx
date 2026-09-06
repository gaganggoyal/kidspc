import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PRODUCT_SHORT_NAME } from '@kidpc/shared';
import { ApiError, type ChildDto, type HouseholdDto, api, setChildToken, setGuardianToken } from '../api';
import { useAutoFocusFirst, useSpatialNavigation } from '../tv';

export const AVATARS: Record<string, string> = {
  fox: '🦊',
  panda: '🐼',
  owl: '🦉',
  turtle: '🐢',
  cat: '🐱',
  robot: '🤖',
  rocket: '🚀',
  dragon: '🐲',
};

/**
 * The TV home screen: who is using the computer? Chosen deliberately as the
 * landing surface after guardian sign-in, because the common case is a
 * household device that stays signed in and gets handed between children.
 */
export function Household() {
  const navigate = useNavigate();
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [picked, setPicked] = useState<ChildDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSpatialNavigation();
  useAutoFocusFirst([household, picked]);

  const load = useCallback(async () => {
    try {
      setHousehold(await api<HouseholdDto>('/me'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not load your household.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="page">
        <div className="notice bad">{error}</div>
      </div>
    );
  }
  if (!household) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  if (picked) {
    return <PinEntry child={picked} onCancel={() => setPicked(null)} />;
  }

  const active = household.children.filter((c) => !c.archivedAt);

  return (
    <div className="tv">
      <div className="page stack">
        <div className="spread">
          <h1>Who&apos;s using {PRODUCT_SHORT_NAME}?</h1>
          <div className="row">
            <Link className="btn" to="/parent">
              Parent settings
            </Link>
            <button
              onClick={async () => {
                await api('/auth/logout', { method: 'POST', as: 'none' });
                setGuardianToken(null);
                navigate('/');
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {active.length === 0 ? (
          <div className="card stack">
            <h2>No children yet</h2>
            <p className="muted">Add a child profile from the parent settings to get started.</p>
            <Link className="btn primary" to="/parent">
              Open parent settings
            </Link>
          </div>
        ) : (
          <div className="profiles">
            {active.map((child) => (
              <button
                key={child.id}
                className="card profile"
                onClick={() => setPicked(child)}
                // A profile that has not been approved yet cannot be entered,
                // and the button says why rather than failing on tap.
                disabled={!child.consentGranted}
              >
                <span className="avatar" aria-hidden="true">
                  {AVATARS[child.avatarId] ?? '🦊'}
                </span>
                <span style={{ fontWeight: 700 }}>{child.displayName}</span>
                <span className="small muted">
                  {child.consentGranted
                    ? `${household.bands[child.band]?.label} · ${child.usageTodayMinutes}/${child.policy.dailyMinutes} min today`
                    : 'Needs a grown-up’s approval'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A four-digit PIN, entered on a D-pad.
 *
 * This is a "which child is this" control, not a security boundary -- the real
 * authentication already happened when the guardian signed this device in. It
 * exists so a younger sibling cannot spend an older one's time budget.
 */
function PinEntry({ child, onCancel }: { child: ChildDto; onCancel: () => void }) {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useSpatialNavigation();
  useAutoFocusFirst([]);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        const { accessToken } = await api<{ accessToken: string }>('/auth/child/login', {
          method: 'POST',
          body: { childId: child.id, pin: value },
        });
        setChildToken(accessToken);
        navigate('/kid');
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.userMessage : 'That did not work.');
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [child.id, navigate],
  );

  const press = (digit: string) => {
    if (busy) return;
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  return (
    <div className="tv">
      <div className="page stack" style={{ maxWidth: 520 }}>
        <div className="row">
          <span className="avatar" style={{ fontSize: '3em' }} aria-hidden="true">
            {AVATARS[child.avatarId] ?? '🦊'}
          </span>
          <h1 style={{ margin: 0 }}>Hi {child.displayName}!</h1>
        </div>
        <p className="muted">Enter your 4-digit code.</p>

        <div className="pin-dots" aria-live="polite" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i}>{i < pin.length ? '●' : '○'}</span>
          ))}
        </div>

        {error && (
          <div className="notice bad" role="alert">
            {error}
          </div>
        )}

        <div className="pinpad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy}>
              {d}
            </button>
          ))}
          <button onClick={() => setPin('')} disabled={busy}>
            Clear
          </button>
          <button onClick={() => press('0')} disabled={busy}>
            0
          </button>
          <button onClick={onCancel}>Back</button>
        </div>
      </div>
    </div>
  );
}
