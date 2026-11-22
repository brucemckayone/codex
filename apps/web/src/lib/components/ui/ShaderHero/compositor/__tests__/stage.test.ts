/**
 * The stage arithmetic (Codex-1yd58.4): the fixed stage's rect (WP-1
 * variant C), its fade, and the culling that keeps a film that does not show
 * from being sampled or uploaded.
 */
import { describe, expect, it } from 'vitest';
import {
  NAME_FADE_PX,
  nameFade,
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

  // The canvas's letters hold still with the stage, so they fade over the
  // first NAME_FADE_PX of scroll, before they part from the page's words by
  // more than that; the page's own glyphs take the name back over the same
  // span (owner, 2026-11-21, the scroll fix's (c)).
  it('fades the letters out over the first 32 px of scroll, far sooner than the film', () => {
    expect(NAME_FADE_PX).toBe(32);
    expect(nameFade(0)).toBe(1);
    expect(nameFade(16)).toBeCloseTo(0.5, 6);
    expect(nameFade(32)).toBe(0);
    expect(nameFade(150)).toBe(0);
    // iOS's rubber band at the top scrolls below 0: the letters stay whole
    expect(nameFade(-40)).toBe(1);
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
