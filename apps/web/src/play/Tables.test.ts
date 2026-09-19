import { describe, expect, it } from 'vitest';
import { ask } from './Tables';

/**
 * What makes a multiplication question answerable is the wrong answers.
 *
 * The first version of this offered the right answer plus or minus one or two,
 * which turned 2 x 9 into "pick one of 16, 17, 18, 19" -- four consecutive
 * numbers that no amount of knowing the two times table helps you choose
 * between. These tests pin the property that replaced it: every distractor is a
 * product a child could plausibly arrive at, and no board is a run of counting
 * numbers.
 */
describe('times tables questions', () => {
  it('offers four distinct positive choices, one of them right', () => {
    for (let i = 0; i < 2000; i++) {
      const q = ask('mixed');
      expect(new Set(q.choices).size).toBe(4);
      expect(q.choices).toContain(q.answer);
      expect(q.choices.every((c) => c > 0)).toBe(true);
      expect(q.a * q.b).toBe(q.answer);
    }
  });

  it('never asks a table below two, or a multiplier of one', () => {
    for (let i = 0; i < 500; i++) {
      const q = ask('mixed');
      expect(q.a).toBeGreaterThanOrEqual(2);
      expect(q.b).toBeGreaterThanOrEqual(2);
    }
  });

  it('stays on the table you chose', () => {
    for (let i = 0; i < 300; i++) expect(ask(7).a).toBe(7);
  });

  it('never offers four consecutive integers', () => {
    for (let i = 0; i < 2000; i++) {
      const sorted = [...ask('mixed').choices].sort((x, y) => x - y);
      const run = sorted.every((n, j) => j === 0 || n === sorted[j - 1]! + 1);
      expect(run).toBe(false);
    }
  });
});
