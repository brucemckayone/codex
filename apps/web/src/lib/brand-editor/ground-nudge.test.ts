// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { groundLuminanceVars, PLATFORM_GROUND_LUMINANCE } from './ground';
import {
  LINK_FLOOR,
  MARK_FLOOR,
  nudgeForGround,
  targetLuminance,
} from './ground-nudge';
import { relativeLuminance } from './ink';

/** 16 levels a channel: 4 096 colours across the whole sRGB cube. */
const LEVELS = Array.from({ length: 16 }, (_, i) =>
  (i * 17).toString(16).padStart(2, '0')
);
const LATTICE = LEVELS.flatMap((r) =>
  LEVELS.flatMap((g) => LEVELS.map((b) => `#${r}${g}${b}`))
);

/**
 * Grounds across both polarities. A floor is unreachable only for a ground
 * within ~0.0004 of the 0.1791 pivot, where neither black nor white clears
 * it; the sweep stays outside that sliver.
 */
const GROUNDS = [
  PLATFORM_GROUND_LUMINANCE.light,
  PLATFORM_GROUND_LUMINANCE.dark,
  0,
  0.008,
  0.05,
  0.12,
  0.178,
  0.18,
  0.25,
  0.5,
  0.8,
  1,
];

describe('the ground a link sits on', () => {
  test('the platform grounds are the #fafafa page and the #262626 surface', () => {
    expect(PLATFORM_GROUND_LUMINANCE.light).toBeCloseTo(
      relativeLuminance('#fafafa') ?? 0,
      4
    );
    expect(PLATFORM_GROUND_LUMINANCE.dark).toBeCloseTo(
      relativeLuminance('#262626') ?? 0,
      4
    );
  });

  test('an org that paints no ground of its own writes nothing', () => {
    expect(groundLuminanceVars({})).toEqual({});
    expect(
      groundLuminanceVars({ background: null, backgroundDark: '#101010' })
    ).toEqual({});
    expect(groundLuminanceVars({ background: 'not-a-colour' })).toEqual({});
  });

  test('the dark ground is the dark background, else the light one', () => {
    expect(groundLuminanceVars({ background: '#ffffff' })).toEqual({
      '--brand-ground-y': '1.0000',
      '--brand-ground-dark-y': '1.0000',
    });
    expect(
      groundLuminanceVars({ background: '#FFFFFF', backgroundDark: '#000000' })
    ).toEqual({
      '--brand-ground-y': '1.0000',
      '--brand-ground-dark-y': '0.0000',
    });
  });
});

describe('the nudge', () => {
  test.each([
    ['links', LINK_FLOOR, 4.5],
    ['focus marks', MARK_FLOOR, 3],
  ])('%s clear their floor for every colour on every ground', (_, floor, wcag) => {
    let worst = Number.POSITIVE_INFINITY;
    for (const ground of GROUNDS) {
      for (const hex of LATTICE) {
        const result = nudgeForGround(hex, ground, floor);
        worst = Math.min(worst, result?.after ?? 0);
      }
    }
    expect(worst).toBeGreaterThanOrEqual(wcag);
  });

  test('a colour that already holds is painted exactly as picked', () => {
    let held = 0;
    for (const ground of [
      PLATFORM_GROUND_LUMINANCE.light,
      PLATFORM_GROUND_LUMINANCE.dark,
    ]) {
      for (const hex of LATTICE) {
        const result = nudgeForGround(hex, ground, LINK_FLOOR);
        if (result && result.before >= LINK_FLOOR) {
          held++;
          expect(result.moved).toBe(false);
          expect(result.hex).toBe(hex.toUpperCase());
        }
      }
    }
    // The check saw both kinds: colours that hold, and (below) ones that move.
    expect(held).toBeGreaterThan(1000);
  });

  test('darkening keeps the colour’s proportions: a pale amber becomes a deep amber, not a grey', () => {
    const result = nudgeForGround(
      '#fde68a',
      PLATFORM_GROUND_LUMINANCE.light,
      LINK_FLOOR
    );
    expect(result?.moved).toBe(true);
    expect(result?.lighten).toBe(false);
    expect(result?.after).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(result?.hex.slice(i, i + 2) ?? '0', 16)
    );
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  test('a dark brand on a dark page is lightened (OBB, studio-beta)', () => {
    for (const hex of ['#A62B0C', '#2563EB']) {
      const result = nudgeForGround(
        hex,
        PLATFORM_GROUND_LUMINANCE.dark,
        LINK_FLOOR
      );
      expect(result?.lighten).toBe(true);
      expect(result?.before).toBeLessThan(4.5);
      expect(result?.after).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the target is a ceiling on a light ground and a floor on a dark one', () => {
    expect(targetLuminance(1, LINK_FLOOR)).toEqual({
      target: 1.05 / LINK_FLOOR - 0.05,
      lighten: false,
    });
    expect(targetLuminance(0, LINK_FLOOR)).toEqual({
      target: LINK_FLOOR * 0.05 - 0.05,
      lighten: true,
    });
  });

  test('a colour that is not hex is not nudged', () => {
    expect(nudgeForGround('oklch(0.5 0.1 30)', 1, LINK_FLOOR)).toBeNull();
  });
});
