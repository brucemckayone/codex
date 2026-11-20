/**
 * The phone budget's decision (Codex-1yd58.4): a window of 120 frames whose
 * 95th-percentile interval is over 25 ms drops the second preset, once.
 */
import { describe, expect, it } from 'vitest';
import {
  BUDGET_FRAMES,
  BUDGET_P95_MS,
  createFrameBudget,
  percentile,
} from '../budget';

/** Push `count` frames of `ms` each; the breaches returned, in order. */
function feed(
  budget: ReturnType<typeof createFrameBudget>,
  ms: number,
  count: number
) {
  const breaches = [];
  for (let i = 0; i < count; i++) {
    const breach = budget.push(ms);
    if (breach) breaches.push(breach);
  }
  return breaches;
}

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile(hundred, 0.5)).toBe(50);
    expect(percentile(hundred, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBeNaN();
  });
});

describe('createFrameBudget', () => {
  it('starts at 120 frames and 25 ms, as approved for WP-3', () => {
    expect(BUDGET_FRAMES).toBe(120);
    expect(BUDGET_P95_MS).toBe(25);
  });

  it('keeps the second through windows that hold 60 fps', () => {
    const budget = createFrameBudget();
    expect(feed(budget, 16.7, BUDGET_FRAMES * 5)).toEqual([]);
  });

  it('keeps it at exactly the budget: over means over', () => {
    expect(feed(createFrameBudget(), BUDGET_P95_MS, BUDGET_FRAMES * 2)).toEqual(
      []
    );
  });

  it('drops it once a window goes over, and says how far over', () => {
    const budget = createFrameBudget();
    expect(feed(budget, 16.7, BUDGET_FRAMES - 1)).toEqual([]);
    // One slow frame among 120 is a hiccup, not the budget.
    expect(budget.push(80)).toEqual(null);
    const breaches = feed(budget, 33, BUDGET_FRAMES);
    expect(breaches).toEqual([{ p95Ms: 33, frames: BUDGET_FRAMES }]);
    // Once: what follows is no news until it is reset.
    expect(feed(budget, 50, BUDGET_FRAMES * 3)).toEqual([]);
  });

  it('judges no window until it is full', () => {
    expect(feed(createFrameBudget(), 100, BUDGET_FRAMES - 1)).toEqual([]);
  });

  it('breaks on a p95 over the budget even when most frames are fast', () => {
    const budget = createFrameBudget();
    // 10 of 120 slow is over 5%: the 95th percentile is a slow frame.
    feed(budget, 16, BUDGET_FRAMES - 10);
    expect(feed(budget, 40, 10)).toEqual([
      { p95Ms: 40, frames: BUDGET_FRAMES },
    ]);
  });

  it('judges afresh after a reset, and counts no stalled or nonsense interval', () => {
    const budget = createFrameBudget();
    feed(budget, 40, BUDGET_FRAMES);
    budget.reset();
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(budget.push(bad)).toBeNull();
    }
    expect(feed(budget, 16, BUDGET_FRAMES)).toEqual([]);
    expect(feed(budget, 40, BUDGET_FRAMES)).toHaveLength(1);
  });

  it('takes its own window and limit', () => {
    const budget = createFrameBudget({ frames: 4, p95Ms: 10 });
    expect(feed(budget, 12, 4)).toEqual([{ p95Ms: 12, frames: 4 }]);
  });
});
