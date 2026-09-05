import { describe, expect, it } from 'vitest';
import {
  MIN_SUPPORTED_AGE,
  ageBandForAge,
  ageBandForBirth,
  ageInYears,
  isMinor,
  localDayKey,
  localWeekday,
  memoryBudgetMib,
  minutesSinceLocalMidnight,
  originsForApps,
  resolveLaunch,
  appsForBand,
  parseClockTime,
  withinWindow,
  newId,
  pairingCode,
} from './index.js';

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe('age', () => {
  it('rounds age down when the birth month has not fully passed', () => {
    // Born March 2016, asked in March 2026: the birthday may not have happened
    // yet this month, so we must not credit the extra year.
    expect(ageInYears({ birthYear: 2016, birthMonth: 3 }, new Date('2026-03-15T00:00:00Z'))).toBe(9);
    expect(ageInYears({ birthYear: 2016, birthMonth: 3 }, new Date('2026-04-01T00:00:00Z'))).toBe(10);
  });

  it('places children in the documented bands', () => {
    expect(ageBandForAge(5)).toBe('explorer');
    expect(ageBandForAge(8)).toBe('explorer');
    expect(ageBandForAge(9)).toBe('builder');
    expect(ageBandForAge(12)).toBe('builder');
    expect(ageBandForAge(13)).toBe('coder');
    expect(ageBandForAge(16)).toBe('coder');
  });

  it('refuses to onboard below the supported age', () => {
    expect(ageBandForAge(MIN_SUPPORTED_AGE - 1)).toBeNull();
    expect(ageBandForBirth({ birthYear: 2024, birthMonth: 1 }, new Date('2026-06-01T00:00:00Z'))).toBeNull();
  });

  it('keeps 17-year-olds inside minor protections and in the Coder band', () => {
    const birth = { birthYear: 2009, birthMonth: 8 };
    const at = new Date('2026-09-05T00:00:00Z');
    expect(ageInYears(birth, at)).toBe(17);
    expect(isMinor(birth, at)).toBe(true);
    expect(ageBandForBirth(birth, at)).toBe('coder');
  });

  it('drops protections only once the profile is genuinely 18', () => {
    expect(isMinor({ birthYear: 2008, birthMonth: 1 }, new Date('2026-09-05T00:00:00Z'))).toBe(false);
  });
});

describe('local time', () => {
  it('assigns the correct IST day to instants either side of UTC midnight', () => {
    // 23:00 UTC is already the next day in India.
    expect(localDayKey(new Date('2026-03-10T23:00:00Z'))).toBe('2026-03-11');
    expect(localDayKey(new Date('2026-03-10T18:29:00Z'))).toBe('2026-03-10');
    expect(localDayKey(new Date('2026-03-10T18:30:00Z'))).toBe('2026-03-11');
  });

  it('reports minutes since local midnight, not UTC midnight', () => {
    expect(minutesSinceLocalMidnight(ist('2026-03-10T00:00:00'))).toBe(0);
    expect(minutesSinceLocalMidnight(ist('2026-03-10T20:15:00'))).toBe(20 * 60 + 15);
  });

  it('rolls the weekday over at local midnight', () => {
    expect(localWeekday(ist('2026-03-10T23:59:00'))).toBe(2); // Tuesday
    expect(localWeekday(ist('2026-03-11T00:01:00'))).toBe(3); // Wednesday
  });

  it('handles windows that wrap past midnight', () => {
    const start = parseClockTime('21:00');
    const end = parseClockTime('06:00');
    expect(withinWindow(parseClockTime('22:30'), start, end)).toBe(true);
    expect(withinWindow(parseClockTime('05:00'), start, end)).toBe(true);
    expect(withinWindow(parseClockTime('12:00'), start, end)).toBe(false);
  });

  it('rejects malformed clock times rather than silently coercing', () => {
    expect(() => parseClockTime('24:00')).toThrow();
    expect(() => parseClockTime('7:00')).toThrow();
  });
});

describe('catalogue', () => {
  it('gives older bands everything the younger bands have', () => {
    const explorer = appsForBand('explorer').map((a) => a.id);
    const coder = appsForBand('coder').map((a) => a.id);
    expect(coder).toEqual(expect.arrayContaining(explorer));
    expect(coder.length).toBeGreaterThan(explorer.length);
  });

  it('derives the network allow-list from the granted apps only', () => {
    const origins = originsForApps(appsForBand('builder'));
    expect(origins).toContain('https://apps.kidspc.online');
    expect(origins).toContain('https://kids.britannica.com');
    // The research app is the only source of external origins; without it the
    // session should be able to reach nothing outside our own hosts.
    const withoutResearch = originsForApps(appsForBand('builder').filter((a) => a.id !== 'research'));
    expect(withoutResearch).toEqual(['https://apps.kidspc.online']);
  });

  it('serves self-hosted apps from whichever origin the environment sets', () => {
    // The same build has to work in development, staging and production. If an
    // origin were baked into the catalogue, a staging desktop would be handed
    // production URLs and an allow-list that does not match what it can reach.
    const staging = originsForApps(appsForBand('builder'), 'https://apps.staging.kidspc.online');
    expect(staging).toContain('https://apps.staging.kidspc.online');
    expect(staging).not.toContain('https://apps.kidspc.online');
    // Third-party origins are absolute and must survive the substitution.
    expect(staging).toContain('https://kids.britannica.com');
  });

  it('resolves a self-hosted launch to a full URL against the configured origin', () => {
    const scratch = appsForBand('builder').find((a) => a.id === 'scratch')!;
    expect(resolveLaunch(scratch.launch, 'http://localhost:8081')).toEqual({
      kind: 'web',
      url: 'http://localhost:8081/scratch/',
    });
    const paint = appsForBand('explorer').find((a) => a.id === 'tuxpaint')!;
    expect(resolveLaunch(paint.launch, 'http://localhost:8081')).toEqual({
      kind: 'native',
      exec: 'tuxpaint',
    });
  });

  it('sizes memory for concurrent use, not for the whole catalogue', () => {
    const all = appsForBand('coder');
    const naiveSum = all.reduce((s, a) => s + a.memoryHintMib, 0);
    expect(memoryBudgetMib(all)).toBeLessThan(naiveSum);
    expect(memoryBudgetMib(all)).toBeGreaterThan(1000);
  });
});

describe('ids', () => {
  it('produces sortable, prefixed identifiers', async () => {
    const a = newId('ses');
    await new Promise((r) => setTimeout(r, 2));
    const b = newId('ses');
    expect(a.startsWith('ses_')).toBe(true);
    expect(a < b).toBe(true);
  });

  it('keeps ambiguous glyphs out of pairing codes', () => {
    for (let i = 0; i < 200; i++) {
      expect(pairingCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});
