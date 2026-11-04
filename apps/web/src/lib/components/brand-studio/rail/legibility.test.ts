// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { PLATFORM_GROUND_LUMINANCE } from '$lib/brand-editor/ground';
import { LINK_FLOOR, nudgeForGround } from '$lib/brand-editor/ground-nudge';
import { hoverFill, legibilityFor } from './legibility';

const LIGHT = PLATFORM_GROUND_LUMINANCE.light;
const DARK = PLATFORM_GROUND_LUMINANCE.dark;
const PALE = '#FDE68A';
const DEEP = '#1D4ED8';

const movedCount = (l: ReturnType<typeof legibilityFor>) =>
  [l.link, l.linkStates, l.brandText, l.focus, l.halo].filter((n) => n?.moved)
    .length;

describe('what the pill lists beyond the resting link (Codex-mik4h)', () => {
  test('with no override, hovered links show only when they move, brand labels never', () => {
    const deep = legibilityFor({ theme: 'light', brand: DEEP });
    expect(deep.link?.moved).toBe(false);
    expect(deep.linkStates).toBeNull();
    expect(deep.brandText).toBeNull();

    const pale = legibilityFor({ theme: 'light', brand: PALE });
    // The hover is the paler of the two fills, so it moved further.
    expect(pale.linkStates?.moved).toBe(true);
    expect(pale.linkStates).toEqual(
      nudgeForGround(hoverFill(PALE, 'light') ?? '', LIGHT, LINK_FLOOR)
    );
    expect(pale.brandText).toBeNull();
    expect(pale.adjusted).toBe(movedCount(pale));
  });

  test('an interactive override sets the brand-coloured labels apart, and they count', () => {
    const l = legibilityFor({
      theme: 'light',
      brand: PALE,
      overrides: { interactive: DEEP },
    });
    expect(l.link?.moved).toBe(false);
    expect(l.brandText?.moved).toBe(true);
    expect(l.brandText?.before).toBeLessThan(LINK_FLOOR);
    // The hover and pressed fills follow the brand colour, not the override.
    expect(l.linkStates?.moved).toBe(true);
    expect(l.adjusted).toBe(movedCount(l));
  });

  test('a hover override is the hovered link the page paints', () => {
    const l = legibilityFor({
      theme: 'light',
      brand: DEEP,
      overrides: { 'interactive-hover': PALE },
    });
    expect(l.linkStates).toEqual(nudgeForGround(PALE, LIGHT, LINK_FLOOR));
    // The labels keep the brand's own hover, which reads: listed as picked.
    expect(l.brandText?.moved).toBe(false);
  });

  test('shows the label that moved furthest, even one from beyond the ground', () => {
    // A near-black brand on a dark page starts at a HIGHER ratio resting
    // (2.62:1) than hovered (2.35:1), yet the resting label moves further:
    // the page paints it, so the row shows it.
    const NEAR_BLACK = '#000024';
    const l = legibilityFor({
      theme: 'dark',
      brand: NEAR_BLACK,
      overrides: { interactive: DEEP },
    });
    expect(l.brandText).toEqual(nudgeForGround(NEAR_BLACK, DARK, LINK_FLOOR));
  });
});
