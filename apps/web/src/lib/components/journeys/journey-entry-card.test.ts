import { describe, expect, test } from 'vitest';
import { resumeProgress } from './journey-entry-card';

/**
 * `resumeProgress` — the resume rail's progress projection (Codex-tnwnu review
 * follow-up).
 *
 * The load-bearing property is the NULL case. A determinate `role="progressbar"`
 * is a claim about how far through something you are, and the library's "Jump
 * back in" rail is filtered to items with `positionSeconds > 0` — so every card
 * in it has been started. Reporting a percent off an unknown denominator made a
 * started-but-never-probed media item announce "0%", which is both wrong for a
 * screen reader and inconsistent with the meta line beside it (which already
 * drops its " of X" clause when the duration is unknown).
 *
 * `null` is therefore not a neutral default here — it is the correct answer, and
 * `JourneyEntryCard` renders no bar at all for it (asserted in
 * `JourneyEntryCard.svelte.test.ts`).
 */
describe('resumeProgress', () => {
  test('reports a percentage when the duration is known', () => {
    expect(resumeProgress(30, 120)).toEqual({ percent: 25, label: null });
    expect(resumeProgress(90, 90)).toEqual({ percent: 100, label: null });
  });

  test('rounds to a whole percent', () => {
    // 1/3 → 33.33…
    expect(resumeProgress(1, 3)?.percent).toBe(33);
    // 2/3 → 66.66…
    expect(resumeProgress(2, 3)?.percent).toBe(67);
  });

  // Tuples typed explicitly: a bare array of mixed literals widens to a union
  // that includes `string`, which `resumeProgress`'s numeric params reject.
  const unknownDurations: [string, number, number | null | undefined][] = [
    ['null duration (never probed)', 90, null],
    ['undefined duration', 90, undefined],
    ['zero duration', 90, 0],
    ['negative duration', 90, -60],
    ['non-finite duration', 90, Number.NaN],
  ];

  test.each(
    unknownDurations
  )('returns null for %s — no bar rather than a false 0%%', (_case, pos, dur) => {
    expect(resumeProgress(pos, dur)).toBeNull();
  });

  test('a position past the duration is clamped, never over 100', () => {
    // Progress rows can outrun a stale duration (re-encoded media, bad probe).
    expect(resumeProgress(500, 100)?.percent).toBe(100);
  });

  test('a missing or non-finite position reads as the start, not as NaN', () => {
    expect(resumeProgress(null, 120)).toEqual({ percent: 0, label: null });
    expect(resumeProgress(undefined, 120)).toEqual({ percent: 0, label: null });
    expect(resumeProgress(Number.NaN, 120)).toEqual({
      percent: 0,
      label: null,
    });
    // A negative position clamps up rather than painting a negative-width fill.
    expect(resumeProgress(-30, 120)).toEqual({ percent: 0, label: null });
  });
});
