/**
 * The cut and WCAG 2.3.1, three flashes (Codex-1yd58.7, review M3): the
 * picture's light falls to the brand's picture and rises at each cut, so the
 * cuts may dip at most 3 times in any second, under both timings, however a
 * visitor taps, pauses and picks.
 */
import { describe, expect, it } from 'vitest';
import {
  CUT_TIMING,
  type CutTiming,
  MIN_CUT_GAP_MS,
  REDUCED_CUT_TIMING,
  RevealClock,
} from './reel-reveal';

const TIMINGS: [string, CutTiming][] = [
  ['the full cut', CUT_TIMING],
  ['reduced motion', REDUCED_CUT_TIMING],
];

/** A visitor's act at `at` ms on the clock. */
type Act =
  | { at: number; kind: 'cut'; to: number }
  | { at: number; kind: 'jump'; to: number }
  | { at: number; kind: 'pause' | 'play' };

/**
 * Play `acts` on a clock and sample `u_reveal` every ms to `until`. A dip is
 * the light falling past half way to the brand's picture: each time it does
 * is one flash's fall.
 */
function dips(
  timing: CutTiming,
  acts: readonly Act[],
  until: number
): number[] {
  const clock = new RevealClock(0, timing);
  const queue = [...acts].sort((a, b) => a.at - b.at);
  const found: number[] = [];
  let low = false;
  for (let t = 0; t <= until; t++) {
    while (queue[0] && queue[0].at <= t) {
      const act = queue.shift();
      if (!act) break;
      if (act.kind === 'cut') clock.cut(act.to, act.at);
      else if (act.kind === 'jump') clock.jump(act.to);
      else if (act.kind === 'pause') clock.pause(act.at);
      else clock.play(act.at);
    }
    const now = clock.at(t).reveal < 0.5;
    if (now && !low) found.push(t);
    low = now;
  }
  return found;
}

/** The most dips in any second, `[t, t + 1000)`. */
function mostInASecond(times: readonly number[]): number {
  let most = 0;
  for (const [i, start] of times.entries()) {
    const within = times.slice(i).filter((t) => t < start + 1000).length;
    most = Math.max(most, within);
  }
  return most;
}

/** A tap every `every` ms to the next of 3 pieces, for `ms`. */
const taps = (every: number, ms: number): Act[] =>
  Array.from({ length: Math.floor(ms / every) }, (_, k) => ({
    at: k * every,
    kind: 'cut' as const,
    to: (k + 1) % 3,
  }));

describe('the cut and three flashes a second (WCAG 2.3.1)', () => {
  it.each(
    TIMINGS
  )('%s takes long enough that back to back it dips at most 3 times a second', (_, timing) => {
    expect(1000 / (timing.outMs + timing.inMs)).toBeLessThanOrEqual(3);
    // 400 ms a cut at least: under reduced motion too.
    expect(timing.outMs + timing.inMs).toBeGreaterThanOrEqual(400);
  });

  it('starts cuts at least a third of a second apart, even after a jump cut the last short', () => {
    expect(MIN_CUT_GAP_MS).toBeGreaterThanOrEqual(1000 / 3);
    const clock = new RevealClock(0, REDUCED_CUT_TIMING);
    clock.cut(1, 0);
    expect(clock.at(50).reveal).toBeLessThan(1);
    // A pick while paused ends it where it is; the next cut comes at once.
    clock.jump(2);
    clock.cut(0, 60);
    // Its fall waits for the gap: the light holds until then.
    expect(clock.at(60).reveal).toBe(1);
    expect(clock.at(MIN_CUT_GAP_MS - 1).reveal).toBe(1);
    expect(clock.at(MIN_CUT_GAP_MS + 20).reveal).toBeLessThan(1);
    expect(clock.at(MIN_CUT_GAP_MS + REDUCED_CUT_TIMING.outMs).shown).toBe(0);
  });

  it.each(
    TIMINGS
  )('%s: rapid taps dip at most 3 times in any second', (_, timing) => {
    for (const every of [10, 25, 60, 140]) {
      const times = dips(timing, taps(every, 4000), 6000);
      expect(times.length, `a tap every ${every} ms`).toBeGreaterThan(1);
      expect(
        mostInASecond(times),
        `a tap every ${every} ms`
      ).toBeLessThanOrEqual(3);
    }
  });

  it.each(
    TIMINGS
  )('%s: picks while paused, each cutting the last short, dip at most 3 times in any second', (_, timing) => {
    // Play, tap, pause, pick (a jump: the cut ends where it is), play, tap
    // again: each new cut would start the moment the jump ended the last.
    const acts: Act[] = [];
    for (let at = 0; at < 4000; at += 120) {
      acts.push({ at, kind: 'cut', to: 1 + ((at / 120) % 2) });
      acts.push({ at: at + timing.outMs * 0.8, kind: 'pause' });
      acts.push({ at: at + timing.outMs * 0.8 + 1, kind: 'jump', to: 0 });
      acts.push({ at: at + timing.outMs * 0.8 + 2, kind: 'play' });
    }
    const times = dips(timing, acts, 6000);
    expect(mostInASecond(times)).toBeLessThanOrEqual(3);
  });

  it('dips at the pace of the timing when nothing cuts it short', () => {
    // Calibration: the count is real, not 0 because the probe never fires.
    const times = dips(REDUCED_CUT_TIMING, taps(10, 2000), 3000);
    expect(times.length).toBeGreaterThanOrEqual(4);
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    for (const gap of gaps)
      expect(gap).toBeGreaterThanOrEqual(
        REDUCED_CUT_TIMING.outMs + REDUCED_CUT_TIMING.inMs
      );
  });
});
