import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasPreviewProgress,
  previewAchievements,
  previewBest,
  recordPreviewBest,
} from './previewProgress';

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  return store;
}

const KEY = 'kidpc.preview.bests';

describe('scores in the preview', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('keeps the best, not the latest', () => {
    stubStorage();
    recordPreviewBest('blocks', 'puzzles_solved', 3);
    recordPreviewBest('blocks', 'puzzles_solved', 1);
    expect(previewBest('blocks', 'puzzles_solved')).toBe(3);
  });

  it('starts with nothing', () => {
    stubStorage();
    expect(hasPreviewProgress()).toBe(false);
    expect(previewBest('paint', 'score')).toBeNull();
  });

  it('writes something a person can read on a card', () => {
    stubStorage();
    recordPreviewBest('typing', 'words_per_minute', 21.4);
    recordPreviewBest('numbers', 'score', 12);
    expect(previewAchievements()).toEqual([
      { label: 'Number Ninja — Best score', value: '12' },
      { label: 'Typing Garden — Typing speed', value: '21 wpm' },
    ]);
  });

  it('drops a score for an activity or metric we no longer have', () => {
    // Otherwise a catalogue change puts `ghost_app:made_up` on the one thing
    // in this product that a parent forwards to their family.
    stubStorage({
      [KEY]: JSON.stringify({ 'ghost:score': 5, 'blocks:made_up': 2, 'blocks:level': 4 }),
    });
    expect(previewAchievements()).toEqual([
      { label: 'Block Puzzles — Reached level', value: '4' },
    ]);
  });

  it('shrugs off a store somebody else has written to', () => {
    stubStorage({ [KEY]: 'not json at all' });
    expect(previewAchievements()).toEqual([]);
    expect(() => recordPreviewBest('paint', 'score', 1)).not.toThrow();
    expect(previewBest('paint', 'score')).toBe(1);
  });

  it('ignores values that are not numbers', () => {
    stubStorage({ [KEY]: JSON.stringify({ 'blocks:level': '9', 'numbers:score': 7 }) });
    expect(previewAchievements()).toEqual([{ label: 'Number Ninja — Best score', value: '7' }]);
  });
});
