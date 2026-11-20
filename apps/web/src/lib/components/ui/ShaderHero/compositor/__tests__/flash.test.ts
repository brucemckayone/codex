/**
 * The flash governor (Codex-1yd58.4; WCAG 2.3.1): an effect marked `flashes`
 * is given a clock with at most 3 values a second, so it cannot change the
 * picture's brightness more often than that, whatever its GLSL does.
 */
import { describe, expect, it } from 'vitest';
import { EFFECTS } from '../effects/registry';
import { effectTime, FLASH_MAX_PER_SECOND, governFlash } from '../flash';

/** The most distinct clock values in any one-second window, sampled at 240 Hz. */
function changesPerSecond(clock: (t: number) => number, seconds = 5): number {
  const step = 1 / 240;
  const samples: number[] = [];
  for (let t = 0; t <= seconds; t += step) samples.push(clock(t));
  let most = 0;
  const window = Math.round(1 / step);
  for (let i = 0; i + window <= samples.length; i++) {
    let changes = 0;
    for (let j = i + 1; j < i + window; j++) {
      if (samples[j] !== samples[j - 1]) changes++;
    }
    most = Math.max(most, changes);
  }
  return most;
}

describe('governFlash', () => {
  it('changes at most 3 times in any second', () => {
    expect(changesPerSecond((t) => governFlash(t))).toBeLessThanOrEqual(
      FLASH_MAX_PER_SECOND
    );
  });

  it('caps a faster request at 3 a second, and honours a slower one', () => {
    expect(changesPerSecond((t) => governFlash(t, 24))).toBeLessThanOrEqual(3);
    expect(changesPerSecond((t) => governFlash(t, 1))).toBeLessThanOrEqual(1);
  });

  it('the raw clock it replaces changes every sample: the governor is what holds it', () => {
    expect(changesPerSecond((t) => t)).toBeGreaterThan(200);
  });

  it('steps down, never ahead, and keeps going forward', () => {
    expect(governFlash(0.32)).toBeCloseTo(0, 9);
    expect(governFlash(0.34)).toBeCloseTo(1 / 3, 9);
    expect(governFlash(10.5)).toBeCloseTo(10.333333333, 6);
    let last = -1;
    for (let t = 0; t < 4; t += 0.01) {
      const g = governFlash(t);
      expect(g).toBeLessThanOrEqual(t + 1e-9);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it('is 0 for a clock that is not a finite, positive time', () => {
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, -2, 0]) {
      expect(governFlash(t)).toBe(0);
    }
    // A rate that is no rate is the cap.
    expect(governFlash(1.5, 0)).toBe(governFlash(1.5));
    expect(governFlash(1.5, Number.NaN)).toBe(governFlash(1.5));
  });
});

describe('effectTime', () => {
  it('governs an effect that flashes, and only that one', () => {
    expect(effectTime({ flashes: true }, 2.9)).toBe(governFlash(2.9));
    expect(effectTime({ flashes: false }, 2.9)).toBe(2.9);
    expect(effectTime({}, 2.9)).toBe(2.9);
  });

  // Each registered effect that flashes (WP-8: glitch, leak), on the clock
  // the compositor hands it, over ten seconds.
  it.each(
    EFFECTS.filter((e) => e.flashes).map((e) => [e.id, e] as const)
  )('gives %s a clock that changes at most 3 times in any second', (_id, effect) => {
    expect(
      changesPerSecond((t) => effectTime(effect, t), 10)
    ).toBeLessThanOrEqual(FLASH_MAX_PER_SECOND);
  });
});
