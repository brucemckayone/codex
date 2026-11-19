/**
 * The stage arithmetic (Codex-1yd58.4): cover mapping (the TS twin of the
 * GLSL `coverUv`), the fixed stage's rect (WP-1 variant C), its fade, and
 * the culling that keeps a film that does not show from being sampled or
 * uploaded.
 */
import { describe, expect, it } from 'vitest';
import { HEADER } from '../effects/header';
import {
  coverUv,
  type StageBox,
  stageBoxFrom,
  stageFade,
  stageRect,
  stageVisible,
} from '../stage';

const close = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i], 6);
  });
};

describe('coverUv', () => {
  it('maps a rect onto media of the same shape one to one', () => {
    for (const p of [
      [0, 0],
      [0.25, 0.8],
      [1, 1],
    ] as const) {
      close(coverUv(p, [400, 300], [800, 600]), p);
    }
  });

  it('crops wider media evenly from both sides, keeping its height whole', () => {
    // A 9:16 frame over 16:9 footage shows its middle 31.6%.
    const ratio = 9 / 16 / (16 / 9);
    close(coverUv([0, 0], [900, 1600], [1600, 900]), [0.5 - ratio / 2, 0]);
    close(coverUv([1, 1], [900, 1600], [1600, 900]), [0.5 + ratio / 2, 1]);
    close(coverUv([0.5, 0.5], [900, 1600], [1600, 900]), [0.5, 0.5]);
  });

  it('crops taller media from top and bottom, keeping its width whole', () => {
    const ratio = 9 / 16 / (16 / 9);
    close(coverUv([0, 0], [1600, 900], [900, 1600]), [0, 0.5 - ratio / 2]);
    close(coverUv([1, 1], [1600, 900], [900, 1600]), [1, 0.5 + ratio / 2]);
  });

  it('never samples outside the media for a point inside the rect', () => {
    for (const media of [
      [1920, 1080],
      [720, 1280],
      [1, 1],
    ] as const) {
      for (const p of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const [u, v] = coverUv(p, [640, 360], media);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('leaves the point alone for a size with no area, not NaN', () => {
    close(coverUv([0.3, 0.7], [0, 0], [1920, 1080]), [0.3, 0.7]);
    close(coverUv([0.3, 0.7], [640, 360], [0, 0]), [0.3, 0.7]);
  });

  it('is the twin of the GLSL coverUv, guard included', () => {
    // The shared header's version: the same ratios, the same zero guard.
    expect(HEADER).toMatch(
      /vec2 coverUv\(vec2 local, vec2 rectPx, vec2 mediaPx\)/
    );
    expect(HEADER).toContain('if (ra <= 0.0 || ma <= 0.0) return local;');
    expect(HEADER).toContain(
      'if (ma > ra) uv.x = 0.5 + (local.x - 0.5) * ra / ma;'
    );
    expect(HEADER).toContain('else uv.y = 0.5 + (local.y - 0.5) * ma / ra;');
  });
});

describe('the fixed stage', () => {
  // A 390x844 phone window: the fixed canvas fills it, drawn at DPR 2.
  const canvas = { left: 0, bottom: 844, width: 390, height: 844 };
  // The frame measured at scrollY 300: 100px down the window, so 400px down
  // the document.
  const box: StageBox = stageBoxFrom(
    { left: 20, top: 100, width: 350, height: 600 },
    300,
    600
  );

  it('holds the frame where it sits with the page at the top', () => {
    expect(box.top).toBe(400);
    // Origin bottom left, in output pixels (x2): 844 - 400 - 600 = -156.
    close(stageRect(box, canvas, 780, 1688), [40, -312, 700, 1200]);
  });

  it('does not move with the scroll: only the fade reads it', () => {
    expect(stageRect(box, canvas, 780, 1688)).toEqual(
      stageRect(box, canvas, 780, 1688)
    );
    expect(stageFade(0, 600)).toBe(1);
    expect(stageFade(300, 600)).toBeCloseTo(0.5, 6);
    expect(stageFade(600, 600)).toBe(0);
    expect(stageFade(5000, 600)).toBe(0);
  });

  it('fades at once with no distance to fade over', () => {
    expect(stageFade(0, 0)).toBe(1);
    expect(stageFade(1, 0)).toBe(0);
  });

  it('is visible only while it shows and overlaps the canvas', () => {
    const rect = stageRect(box, canvas, 780, 1688);
    expect(stageVisible(rect, 780, 1688, 1)).toBe(true);
    // Faded out: culled.
    expect(stageVisible(rect, 780, 1688, 0)).toBe(false);
    // Off the canvas, on any side, or with no area: culled.
    expect(stageVisible([800, 0, 100, 100], 780, 1688, 1)).toBe(false);
    expect(stageVisible([-200, 0, 100, 100], 780, 1688, 1)).toBe(false);
    expect(stageVisible([0, 1700, 100, 100], 780, 1688, 1)).toBe(false);
    expect(stageVisible([0, -300, 100, 100], 780, 1688, 1)).toBe(false);
    expect(stageVisible([10, 10, 0, 100], 780, 1688, 1)).toBe(false);
  });

  it('measures nothing on a canvas with no size', () => {
    close(
      stageRect(box, { left: 0, bottom: 0, width: 0, height: 0 }, 0, 0),
      [0, 0, 0, 0]
    );
  });
});
