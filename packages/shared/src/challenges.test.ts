import { describe, expect, it } from 'vitest';
import {
  CHALLENGES,
  challengeForWeek,
  challengeWeekKey,
  weekIndex,
  weekWindow,
} from './challenges.js';
import { deliveryOf, findApp } from './catalog.js';

const IST = 'Asia/Kolkata';

describe('weekly challenges', () => {
  it('only ever points at an activity that runs in the browser', () => {
    // A challenge naming Scratch or Python would be unattemptable in the free
    // preview and on every Lite household -- which is most of them. The
    // catalogue is the arbiter, so this stays true as the catalogue changes.
    for (const challenge of CHALLENGES) {
      const app = findApp(challenge.appId);
      expect(app, `${challenge.id} names an unknown app`).toBeDefined();
      expect(deliveryOf(app!.launch), `${challenge.id} needs a streamed desktop`).toBe('local');
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });

  it('is the same all week and different the next', () => {
    const monday = new Date('2026-09-07T06:00:00+05:30');
    const saturday = new Date('2026-09-12T21:00:00+05:30');
    const nextMonday = new Date('2026-09-14T06:00:00+05:30');

    expect(challengeForWeek(saturday, IST)).toEqual(challengeForWeek(monday, IST));
    expect(challengeForWeek(nextMonday, IST)).not.toEqual(challengeForWeek(monday, IST));
  });

  it('rolls over at local midnight on Monday, not at UTC midnight', () => {
    // 23:30 Sunday in Kolkata is 18:00 UTC Sunday. A UTC-based week would
    // already have rolled; a household one would not.
    const sundayNight = new Date('2026-09-13T23:30:00+05:30');
    const mondayMorning = new Date('2026-09-14T00:30:00+05:30');
    expect(weekIndex(sundayNight, IST)).toBe(weekIndex(mondayMorning, IST) - 1);
  });

  it('works for dates before the epoch', () => {
    const before = new Date('2025-06-01T12:00:00+05:30');
    expect(weekIndex(before, IST)).toBeLessThan(0);
    // The modulo must not produce a negative index.
    expect(CHALLENGES).toContain(challengeForWeek(before, IST));
  });

  it('gets through every prompt before repeating', () => {
    const start = new Date('2026-01-05T09:00:00+05:30');
    const seen = new Set<string>();
    for (let week = 0; week < CHALLENGES.length; week++) {
      const at = new Date(start.getTime() + week * 7 * 86_400_000);
      seen.add(challengeForWeek(at, IST).id);
    }
    expect(seen.size).toBe(CHALLENGES.length);
  });

  it('bounds the week with a Monday and the Sunday after it', () => {
    const { start, end } = weekWindow(new Date('2026-09-10T15:00:00+05:30'), IST);
    expect(start.getUTCDay()).toBe(1);
    expect(end.getUTCDay()).toBe(0);
    expect(end.getTime() - start.getTime()).toBe(6 * 86_400_000);
  });

  it('keys a week the way a human would write it', () => {
    expect(challengeWeekKey(new Date('2026-01-07T09:00:00+05:30'), IST)).toBe('2026-W02');
  });
});
