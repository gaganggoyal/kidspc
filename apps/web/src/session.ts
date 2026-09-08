import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The countdown a child sees while they are using their time.
 *
 * The obvious implementation -- and the one this replaces -- kept the server's
 * `remainingMinutes` in state, overwrote it on every heartbeat, and separately
 * decremented it once a minute so the number moved in between. Two writers, one
 * value, no shared idea of the time: a heartbeat landing just after a local
 * decrement put the higher number back, so the clock visibly counted 20 → 19 →
 * 20 in front of a child who had been told what it meant.
 *
 * So there is one writer and one source of truth. A heartbeat sets a deadline;
 * everything on screen is derived from how far away that deadline is. The
 * display can then only move in one direction between heartbeats, because the
 * only thing changing is the clock on the wall.
 *
 * Rounded up, deliberately. The server counts whole elapsed minutes, so "1 min
 * left" should mean up to a minute remains rather than none -- a child watching
 * it reach zero with time still on the lease learns the number is lying.
 */
const TICK_MS = 10_000;

export interface SessionClock {
  /** Whole minutes left, or null before the first heartbeat has landed. */
  remaining: number | null;
  /** Feed in the server's figure. Safe to call from any heartbeat. */
  sync: (remainingMinutes: number) => void;
}

export function useSessionClock(): SessionClock {
  const deadline = useRef<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const read = useCallback(() => {
    if (deadline.current === null) return null;
    return Math.max(0, Math.ceil((deadline.current - Date.now()) / 60_000));
  }, []);

  const sync = useCallback(
    (remainingMinutes: number) => {
      deadline.current = Date.now() + remainingMinutes * 60_000;
      setRemaining(read());
    },
    [read],
  );

  // Faster than a minute on purpose: a tick every ten seconds means the number
  // is never more than ten seconds stale, and because it is derived rather than
  // decremented, ticking often costs nothing and never double-counts.
  useEffect(() => {
    const timer = setInterval(() => setRemaining(read()), TICK_MS);
    return () => clearInterval(timer);
  }, [read]);

  return { remaining, sync };
}
