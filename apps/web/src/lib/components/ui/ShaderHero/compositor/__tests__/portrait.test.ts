/**
 * The frame rule (WP-5b, owner 2026-11-21): a portrait piece that filling
 * the stage would crop by more than 40% is placed flush right on a desktop,
 * not cropped. Pure, so pinned here without a GL context.
 */
import { describe, expect, it } from 'vitest';
import { coverCrop, PORTRAIT_CROP, placedFrame } from '../portrait';

/** A 1440x900 desktop stage at 2x, in output pixels. */
const DESK = [2880, 1800] as const;

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
    expect(placedFrame('film-fill', DESK, [720, 1280], false)).toBe(
      'film-portrait'
    );
    expect(placedFrame('film-fill', DESK, [1200, 1500], false)).toBe(
      'film-portrait'
    );
  });

  it('fills a phone’s stage, whatever the piece', () => {
    expect(placedFrame('film-fill', [700, 1200], [720, 1280], true)).toBe(
      'film-fill'
    );
    expect(placedFrame('film-fill', DESK, [720, 1280], true)).toBe('film-fill');
  });

  it('fills when the crop is at or under the threshold', () => {
    // 1:1 in 16:10 crops 37.5%: under 40%, so it fills.
    expect(coverCrop(DESK, [1000, 1000])).toBeLessThan(PORTRAIT_CROP);
    expect(placedFrame('film-fill', DESK, [1000, 1000], false)).toBe(
      'film-fill'
    );
    // 16:9 in 16:10 barely crops.
    expect(placedFrame('film-fill', DESK, [1920, 1080], false)).toBe(
      'film-fill'
    );
  });

  it('fills with a piece wider than the stage, however much it crops: placed at full height it would overflow', () => {
    // A 4:1 banner in 16:10 crops 60%, but on its long side.
    expect(coverCrop(DESK, [4000, 1000])).toBeGreaterThan(PORTRAIT_CROP);
    expect(placedFrame('film-fill', DESK, [4000, 1000], false)).toBe(
      'film-fill'
    );
  });

  it('keeps every other frame: the name window is never re-placed', () => {
    expect(placedFrame('film-name', DESK, [720, 1280], false)).toBe(
      'film-name'
    );
  });
});
