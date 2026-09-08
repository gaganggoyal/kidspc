import { describe, expect, it } from 'vitest';
import { build } from './Numbers';

/**
 * The property that matters is not "the choices are in a random order" -- the
 * comparator this replaced produced a random-looking order too. It is that the
 * answer is equally likely to be under each of the four buttons, because a
 * child cannot learn a position that does not exist.
 */
const DRAWS = 4000;

describe('Number Ninja questions', () => {
  it('offers four distinct non-negative choices, one of them right', () => {
    for (let level = 1; level <= 10; level++) {
      for (let i = 0; i < 200; i++) {
        const q = build(level);
        expect(q.choices).toHaveLength(4);
        expect(new Set(q.choices).size).toBe(4);
        expect(q.choices).toContain(q.answer);
        expect(q.choices.every((c) => c >= 0)).toBe(true);
      }
    }
  });

  it('never puts the answer in a subtraction below zero', () => {
    for (let i = 0; i < 500; i++) expect(build(4).answer).toBeGreaterThanOrEqual(0);
  });

  it('puts the answer under each button about equally often', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < DRAWS; i++) {
      const q = build(6);
      counts[q.choices.indexOf(q.answer)]! += 1;
    }
    // Four positions, so a quarter each. The band is wide enough that a fair
    // shuffle will not trip it, and narrow enough that the sort-comparator
    // version -- which was off by a factor of two -- cannot pass.
    const expected = DRAWS / 4;
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });
});
