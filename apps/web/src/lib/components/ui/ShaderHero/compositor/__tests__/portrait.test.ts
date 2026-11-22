/**
 * The frame rule: a PORTRAIT piece on a landscape-shaped stage, that filling
 * would crop by more than 40%, is placed flush right, not filled: a film and
 * a picture alike, 62% of the stage's width, cover-cropped about its centre
 * (trimmed top and bottom). The rule is the stage's shape, not the device: a
 * phone held sideways places it too, one held upright fills. Pure, so pinned
 * here without a GL context.
 */
import { describe, expect, it } from 'vitest';
import {
  coverCrop,
  PORTRAIT_CROP,
  PORTRAIT_MIN_WIDTH,
  placedFrame,
  placedRect,
} from '../portrait';

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

describe('placedRect', () => {
  /** The stages the board measured: 1440x900 and 1280x800 (16:10), and the
   *  1440 Wide hero's own stage beside the side bar, 1386x900. */
  const STAGES = [
    [1440, 900],
    [1280, 800],
    [1386, 900],
  ] as const;
  const FILM = [720, 1280] as const; // 9:16, OBB's previews
  const STILL_45 = [1200, 1500] as const;
  const STILL_23 = [1000, 1500] as const;

  it('draws a placed piece at least 62% of the stage’s width', () => {
    expect(PORTRAIT_MIN_WIDTH).toBe(0.62);
  });

  it('places a 9:16 film, a 4:5 and a 2:3 picture flush right, 62% wide, at the stage’s full height', () => {
    for (const stage of STAGES) {
      for (const media of [FILM, STILL_45, STILL_23]) {
        const rect = placedRect('film-fill', stage, media);
        expect(rect, `${media} in ${stage}`).not.toBeNull();
        expect(rect?.x0).toBeCloseTo(0.38, 10);
        expect(rect?.x1).toBe(1);
        expect(rect?.y0).toBe(0);
        expect(rect?.y1).toBe(1);
      }
    }
  });

  it('trims what the width cuts off its height, half off the top and half off the bottom (the cover maths)', () => {
    // crop = 1 - (its own width at the stage's height) / 62%:
    // 16:10, 9:16: 1 - (900 x 0.5625 / 1440) / 0.62 = 1 - 0.3515625 / 0.62
    expect(placedRect('film-fill', [1440, 900], FILM)?.crop).toBeCloseTo(
      0.43296371,
      7
    );
    expect(placedRect('film-fill', [1280, 800], FILM)?.crop).toBeCloseTo(
      0.43296371,
      7
    );
    // 4:5: 1 - 0.5 / 0.62; 2:3: 1 - 0.41666667 / 0.62
    expect(placedRect('film-fill', [1440, 900], STILL_45)?.crop).toBeCloseTo(
      0.19354839,
      7
    );
    expect(placedRect('film-fill', [1280, 800], STILL_23)?.crop).toBeCloseTo(
      0.32795699,
      7
    );
    // beside the side bar the stage is a little narrower, so a little less goes
    expect(placedRect('film-fill', [1386, 900], FILM)?.crop).toBeCloseTo(
      0.41087139,
      7
    );
    expect(placedRect('film-fill', [1386, 900], STILL_45)?.crop).toBeCloseTo(
      0.16212819,
      7
    );
  });

  it('keeps the piece’s own shape: never stretched, only trimmed', () => {
    for (const stage of STAGES) {
      for (const media of [FILM, STILL_45, STILL_23]) {
        const rect = placedRect('film-fill', stage, media);
        if (!rect) throw new Error(`${media} in ${stage} was not placed`);
        // drawn width over its whole height, the trimmed part included
        const width = (rect.x1 - rect.x0) * stage[0];
        const height = ((rect.y1 - rect.y0) * stage[1]) / (1 - rect.crop);
        expect(width / height).toBeCloseTo(media[0] / media[1], 10);
      }
    }
  });

  it('draws a film and a picture alike: what decides is the piece’s shape, not what it is', () => {
    // the same shape as the film, as a picture: the same rect
    expect(placedRect('film-fill', [1440, 900], [1080, 1920])).toEqual(
      placedRect('film-fill', [1440, 900], FILM)
    );
  });

  it('is exactly 62% wide for every placed piece: placing needs a crop past 40%, so its own width is under 60%', () => {
    for (const media of [
      [1000, 1650],
      [900, 1500],
      [400, 1600],
    ] as const) {
      const rect = placedRect('film-fill', [2880, 1800], media);
      expect(rect?.x1 && rect.x1 - rect.x0).toBeCloseTo(PORTRAIT_MIN_WIDTH, 10);
    }
  });

  it('places nothing that fills: a square or a landscape piece, or one held upright on a phone', () => {
    for (const stage of STAGES) {
      expect(placedRect('film-fill', stage, [1000, 1000])).toBeNull();
      expect(placedRect('film-fill', stage, [1600, 900])).toBeNull();
      expect(placedFrame('film-fill', stage, [1000, 1000])).toBe('film-fill');
      expect(placedFrame('film-fill', stage, [1600, 900])).toBe('film-fill');
    }
    expect(placedRect('film-fill', [700, 1200], FILM)).toBeNull();
  });

  it('places only under the fill frame, or the portrait frame it chose: never through the name window', () => {
    expect(placedRect('film-name', [1440, 900], FILM)).toBeNull();
    expect(placedRect('film-portrait', [1440, 900], FILM)).toEqual(
      placedRect('film-fill', [1440, 900], FILM)
    );
  });

  it('agrees with the frame rule: a rect exactly where `placedFrame` places', () => {
    for (const stage of [
      ...STAGES,
      [700, 1200],
      [1100, 1000],
      [2532, 1170],
    ] as const) {
      for (const media of [
        FILM,
        STILL_45,
        STILL_23,
        [1000, 1000],
        [1600, 900],
      ] as const) {
        const placed =
          placedFrame('film-fill', stage, media) === 'film-portrait';
        expect(
          placedRect('film-fill', stage, media) !== null,
          `${media} in ${stage}`
        ).toBe(placed);
      }
    }
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
