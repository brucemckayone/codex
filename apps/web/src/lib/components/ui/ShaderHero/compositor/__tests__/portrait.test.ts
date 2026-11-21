/**
 * The frame rule (WP-5b, owner 2026-11-21): a PORTRAIT piece on a
 * landscape-shaped stage, that filling would crop by more than 40%, is
 * placed flush right, not cropped. The rule is the stage's shape, not the
 * device (review L4): a phone held sideways places it too, one held upright
 * fills. Pure, so pinned here without a GL context.
 */
import { describe, expect, it } from 'vitest';
import { coverCrop, PORTRAIT_CROP, placedFrame } from '../portrait';

/** A 1440x900 desktop stage at 2x, in output pixels. */
const DESK = [2880, 1800] as const;
/** A 1360x790 laptop stage. */
const LAPTOP = [1360, 790] as const;
/** A 2560x950 ultrawide stage. */
const ULTRAWIDE = [2560, 950] as const;

describe('coverCrop', () => {
  it('is the share of the media that covering the rect cuts away', () => {
    expect(coverCrop([1600, 900], [1600, 900])).toBe(0);
    // 9:16 in 16:10: 1 - (9/16) / (16/10)
    expect(coverCrop(DESK, [720, 1280])).toBeCloseTo(1 - 0.5625 / 1.6, 10);
    // the same either way round
    expect(coverCrop([720, 1280], DESK)).toBeCloseTo(
      coverCrop(DESK, [720, 1280]),
      10
    );
  });

  it('is 0 for a side not known yet, not NaN', () => {
    expect(coverCrop([0, 900], [720, 1280])).toBe(0);
    expect(coverCrop(DESK, [0, 0])).toBe(0);
  });
});

describe('placedFrame', () => {
  it('places a 9:16 film and a 4:5 still on a desktop (OBB’s pieces)', () => {
    expect(placedFrame('film-fill', DESK, [720, 1280])).toBe('film-portrait');
    expect(placedFrame('film-fill', DESK, [1200, 1500])).toBe('film-portrait');
  });

  it('places them on a phone held sideways too: the stage’s shape decides (L4)', () => {
    // an 844x390 phone on its side at 3x
    expect(placedFrame('film-fill', [2532, 1170], [720, 1280])).toBe(
      'film-portrait'
    );
  });

  it('fills a phone held upright: its stage is portrait, and crops little', () => {
    expect(coverCrop([700, 1200], [720, 1280])).toBeLessThan(PORTRAIT_CROP);
    expect(placedFrame('film-fill', [700, 1200], [720, 1280])).toBe(
      'film-fill'
    );
    // and a portrait stage never places, even a piece it would crop hard
    expect(placedFrame('film-fill', [700, 1600], [1080, 1350])).toBe(
      'film-fill'
    );
  });

  it('fills a square or a landscape piece, however much it crops: only a portrait one is placed (M3)', () => {
    // 1:1 on a laptop crops 42%
    expect(coverCrop(LAPTOP, [1000, 1000])).toBeGreaterThan(PORTRAIT_CROP);
    expect(placedFrame('film-fill', LAPTOP, [1000, 1000])).toBe('film-fill');
    // 4:3 and 3:2 on an ultrawide crop 50% and 44%
    for (const media of [
      [1600, 1200],
      [1500, 1000],
    ] as const) {
      expect(coverCrop(ULTRAWIDE, media)).toBeGreaterThan(PORTRAIT_CROP);
      expect(placedFrame('film-fill', ULTRAWIDE, media)).toBe('film-fill');
    }
    // a 4:1 banner, wider than the stage
    expect(placedFrame('film-fill', DESK, [4000, 1000])).toBe('film-fill');
  });

  it('fills when a portrait piece crops at or under the threshold', () => {
    // 4:5 in a near-square landscape stage crops 27%
    expect(coverCrop([1100, 1000], [1200, 1500])).toBeLessThan(PORTRAIT_CROP);
    expect(placedFrame('film-fill', [1100, 1000], [1200, 1500])).toBe(
      'film-fill'
    );
  });

  it('keeps every other frame: the name window is never re-placed', () => {
    expect(placedFrame('film-name', DESK, [720, 1280])).toBe('film-name');
  });
});
