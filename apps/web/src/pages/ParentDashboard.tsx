import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATALOG, appsForBand } from '@kidpc/shared';
import { ApiError, type ChildDto, type HouseholdDto, type PolicyDto, api } from '../api';
import { AVATARS } from './Household';

interface UsageDto {
  history: Array<{ dayKey: string; minutes: number }>;
  sessions: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    minutes: number;
    endReason: string | null;
    app: string | null;
  }>;
}

export function ParentDashboard() {
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<HouseholdDto>('/me');
      setHousehold(data);
      setSelected((current) => current ?? data.children.find((c) => !c.archivedAt)?.id ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not load your household.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="page"><div className="notice bad">{error}</div></div>;
  if (!household) return <div className="page"><div className="skeleton" style={{ height: 240 }} /></div>;

  const child = household.children.find((c) => c.id === selected) ?? null;

  return (
    <div className="page stack">
      <div className="spread">
        <div>
          <h1 style={{ margin: 0 }}>Parent settings</h1>
          <div className="muted small">
            Signed in as {household.guardian.email} · {household.guardian.timezone}
          </div>
        </div>
        <Link className="btn" to="/household">
          Back to profiles
        </Link>
      </div>

      <div className="chips">
        {household.children
          .filter((c) => !c.archivedAt)
          .map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={c.id === selected}
              onClick={() => setSelected(c.id)}
            >
              <span aria-hidden="true">{AVATARS[c.avatarId] ?? '🦊'}</span>
              {c.displayName}
            </button>
          ))}
        <button className="chip" onClick={() => setAdding(true)}>
          + Add a child
        </button>
      </div>

      {adding && (
        <AddChild
          onDone={async () => {
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {child && <ChildPanel key={child.id} child={child} onChanged={load} />}

      <PrivacyPanel />
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddChild({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const now = new Date();
  const [form, setForm] = useState({
    displayName: '',
    birthYear: now.getFullYear() - 9,
    birthMonth: 1,
    avatarId: 'fox',
    pin: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/children', { method: 'POST', body: form });
      onDone();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? Object.values(cause.details)[0]?.toString() || cause.userMessage
          : 'Could not add this child.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Add a child</h2>

      <div className="field">
        <label htmlFor="name">Their name</label>
        <input
          id="name"
          type="text"
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          required
        />
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="year">Birth year</label>
          <input
            id="year"
            type="number"
            min={now.getFullYear() - 25}
            max={now.getFullYear()}
            value={form.birthYear}
            onChange={(e) => setForm({ ...form, birthYear: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="month">Birth month</label>
          <select
            id="month"
            value={form.birthMonth}
            onChange={(e) => setForm({ ...form, birthMonth: Number(e.target.value) })}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        We ask for the month and year only — never a full date of birth. It is used to pick the
        right learning track and nothing else.
      </p>

      <div className="field">
        <label htmlFor="avatar">Picture</label>
        <div className="chips">
          {Object.entries(AVATARS).map(([id, glyph]) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={form.avatarId === id}
              aria-label={id}
              onClick={() => setForm({ ...form, avatarId: id })}
            >
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="pin">Their 4-digit code</label>
        <input
          id="pin"
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          value={form.pin}
          onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
          required
        />
        <div className="small muted" style={{ marginTop: 6 }}>
          This just tells profiles apart on a shared TV. It is not a password.
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}

      <div className="row">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add child'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function ChildPanel({ child, onChanged }: { child: ChildDto; onChanged: () => Promise<void> }) {
  const [usage, setUsage] = useState<UsageDto | null>(null);

  useEffect(() => {
    void api<UsageDto>(`/children/${child.id}/usage`).then(setUsage).catch(() => setUsage(null));
  }, [child.id]);

  return (
    <div className="stack">
      {!child.consentGranted && <ConsentPanel child={child} onGranted={onChanged} />}

      <div className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            {child.displayName} · {child.age} years old
          </h2>
          <span className="muted small">
            {child.usageTodayMinutes} of {child.policy.dailyMinutes} minutes used today
          </span>
        </div>

        {usage && (
          <>
            <div className="bars" aria-label="Screen time over the last two weeks">
              {usage.history.map((day) => {
                const peak = Math.max(60, ...usage.history.map((d) => d.minutes));
                return (
                  <div
                    key={day.dayKey}
                    className={day.minutes === 0 ? 'empty' : ''}
                    style={{ height: `${Math.max(2, (day.minutes / peak) * 100)}%` }}
                    title={`${day.dayKey}: ${day.minutes} min`}
                  />
                );
              })}
            </div>
            <div className="small muted">Last 14 days</div>
          </>
        )}
      </div>

      <PolicyEditor child={child} onSaved={onChanged} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConsentPanel({ child, onGranted }: { child: ChildDto; onGranted: () => Promise<void> }) {
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    instructions: string;
    redirectUrl: string | null;
    devHint: string | null;
  } | null>(null);
  const [proof, setProof] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setChallenge(
        await api(`/children/${child.id}/consent/start`, {
          method: 'POST',
          body: { method: 'dev_mock', scopes: ['account', 'progress'] },
        }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not start approval.');
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/children/${child.id}/consent/complete`, {
        method: 'POST',
        body: { challengeId: challenge.challengeId, proof },
      });
      await onGranted();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'That approval did not work.');
      setChallenge(null);
      setProof('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice stack">
      <h2 style={{ margin: 0 }}>{child.displayName} needs your approval</h2>
      <p style={{ margin: 0 }}>
        Indian law requires a verified parent or guardian to approve an account for anyone under
        18 before it can be used. This is a one-time check.
      </p>

      {!challenge ? (
        <button className="primary" onClick={() => void start()} disabled={busy}>
          {busy ? 'Starting…' : 'Approve this account'}
        </button>
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>{challenge.instructions}</p>
          {challenge.redirectUrl && (
            <a className="btn primary" href={challenge.redirectUrl}>
              Continue to DigiLocker
            </a>
          )}
          {challenge.devHint && (
            <div className="field">
              <label htmlFor="proof">Approval code</label>
              <input
                id="proof"
                type="text"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
              />
            </div>
          )}
          <button className="primary" onClick={() => void complete()} disabled={busy || !proof}>
            {busy ? 'Checking…' : 'Confirm approval'}
          </button>
        </div>
      )}

      {error && <div className="notice bad">{error}</div>}

      <p className="small muted" style={{ margin: 0 }}>
        We keep proof that consent was given — never a copy of your ID.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PolicyEditor({ child, onSaved }: { child: ChildDto; onSaved: () => Promise<void> }) {
  const [policy, setPolicy] = useState<PolicyDto>(child.policy);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only apps suited to this child's band are ever offered. A parent cannot
  // grant something above the band, so we do not pretend the option exists.
  const available = appsForBand(child.band);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/children/${child.id}/policy`, {
        method: 'PUT',
        body: {
          dailyMinutes: policy.dailyMinutes,
          weeklyMinutes: policy.weeklyMinutes,
          allowedWindows: policy.allowedWindows,
          allowedAppIds: policy.allowedAppIds,
          sessionSummaries: policy.sessionSummaries,
          idleTimeoutMinutes: policy.idleTimeoutMinutes,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const toggleApp = (appId: string) => {
    setPolicy((p) => ({
      ...p,
      allowedAppIds: p.allowedAppIds.includes(appId)
        ? p.allowedAppIds.filter((id) => id !== appId)
        : [...p.allowedAppIds, appId],
    }));
  };

  const addWindow = () =>
    setPolicy((p) => ({
      ...p,
      allowedWindows: [...p.allowedWindows, { days: [1, 2, 3, 4, 5], start: '16:00', end: '18:30' }],
    }));

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Limits for {child.displayName}</h2>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="daily">Minutes per day</label>
          <input
            id="daily"
            type="number"
            min={0}
            max={1440}
            value={policy.dailyMinutes}
            onChange={(e) => setPolicy({ ...policy, dailyMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="weekly">Minutes per week (optional)</label>
          <input
            id="weekly"
            type="number"
            min={0}
            max={10080}
            value={policy.weeklyMinutes ?? ''}
            placeholder="No weekly limit"
            onChange={(e) =>
              setPolicy({
                ...policy,
                weeklyMinutes: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="idle">Pause after idle (minutes)</label>
          <input
            id="idle"
            type="number"
            min={2}
            max={60}
            value={policy.idleTimeoutMinutes}
            onChange={(e) => setPolicy({ ...policy, idleTimeoutMinutes: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="stack">
        <div className="spread">
          <strong>When they can use it</strong>
          <button onClick={addWindow}>+ Add a time window</button>
        </div>
        {policy.allowedWindows.length === 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            No windows set — the daily limit applies at any time of day.
          </p>
        )}
        {policy.allowedWindows.map((window, index) => (
          <div key={index} className="card stack">
            <div className="row">
              <input
                type="text"
                aria-label="Start time"
                value={window.start}
                style={{ width: 110 }}
                onChange={(e) => {
                  const next = [...policy.allowedWindows];
                  next[index] = { ...window, start: e.target.value };
                  setPolicy({ ...policy, allowedWindows: next });
                }}
              />
              <span>to</span>
              <input
                type="text"
                aria-label="End time"
                value={window.end}
                style={{ width: 110 }}
                onChange={(e) => {
                  const next = [...policy.allowedWindows];
                  next[index] = { ...window, end: e.target.value };
                  setPolicy({ ...policy, allowedWindows: next });
                }}
              />
              <button
                className="danger"
                onClick={() =>
                  setPolicy({
                    ...policy,
                    allowedWindows: policy.allowedWindows.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
            <div className="chips">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  className="chip"
                  aria-pressed={window.days.length === 0 || window.days.includes(day)}
                  onClick={() => {
                    const days = window.days.includes(day)
                      ? window.days.filter((d) => d !== day)
                      : [...window.days, day];
                    const next = [...policy.allowedWindows];
                    next[index] = { ...window, days };
                    setPolicy({ ...policy, allowedWindows: next });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="stack">
        <strong>Apps {child.displayName} can open</strong>
        <div className="chips">
          {available.map((app) => (
            <button
              key={app.id}
              className="chip"
              aria-pressed={policy.allowedAppIds.includes(app.id)}
              onClick={() => toggleApp(app.id)}
            >
              {app.name}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {CATALOG.length - available.length} more app
          {CATALOG.length - available.length === 1 ? '' : 's'} unlock as {child.displayName} moves
          into the next age band.
        </p>
      </div>

      <div className="stack">
        <label className="row" style={{ gap: 10 }}>
          <input
            type="checkbox"
            checked={policy.sessionSummaries}
            onChange={(e) => setPolicy({ ...policy, sessionSummaries: e.target.checked })}
          />
          <span>Show me a summary of each session</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {child.displayName} is told on their home screen whenever this is on. We do not build
          behavioural profiles of children, and never show them advertising.
        </p>
      </div>

      {error && <div className="notice bad">{error}</div>}

      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save limits'}
        </button>
        {saved && <span className="muted small">Saved.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PrivacyPanel() {
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    setBusy(true);
    try {
      const data = await api<unknown>('/privacy/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'kidpc-data-export.json';
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const erase = async () => {
    // Irreversible and immediate, so the confirmation spells out what goes.
    const confirmed = window.confirm(
      'This permanently deletes your account, every child profile, and all saved work. It cannot be undone. Continue?',
    );
    if (!confirmed) return;
    await api('/privacy/erase', { method: 'POST' });
    window.location.href = '/';
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Your data</h2>
      <p className="muted" style={{ margin: 0 }}>
        You can take everything with you or delete it entirely, at any time, without asking us.
      </p>
      <div className="row">
        <button onClick={() => void exportData()} disabled={busy}>
          Download my data
        </button>
        <button className="danger" onClick={() => void erase()}>
          Delete my account
        </button>
      </div>
    </div>
  );
}
