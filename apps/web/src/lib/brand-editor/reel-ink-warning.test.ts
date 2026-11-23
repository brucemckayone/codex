// @vitest-environment node
/**
 * The Showreel's ink warning judges the ink the reel draws its words in, not
 * a brand colour: on a dark ground that is the
 * player text, on a light one the derived text colour, which always passes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { groundPoles } from '$lib/org-hero/showreel/reel-scrim';
import { groundLuminanceVars } from './ground';
import { TEXT_ON_BRAND_LUMINANCE_PIVOT } from './ink';
import {
  PLATFORM_PAGE_GROUND,
  REEL_BODY_FLOOR,
  reelInkWarnings,
} from './reel-ink-warning';

const styles = join(dirname(fileURLToPath(import.meta.url)), '../styles');
const sheet = (path: string) =>
  readFileSync(join(styles, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const OBB_GROUND = '#0F0000';
const playerText = (colour: string) => ({ 'player-text': colour });

describe('reelInkWarnings: the reel ink, on a dark ground', () => {
  test('OBB, its red as primary and no player text of its own: no warning (its reel words are white)', () => {
    expect(
      reelInkWarnings({ background: OBB_GROUND, tokenOverrides: {} })
    ).toEqual([]);
  });

  test('a player text of #CB213C on #0F0000 warns at 3.75 against 4.5, in both themes', () => {
    // The dark theme has no ground or player text of its own: it falls back
    // to the light ones, as the stylesheet does.
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: playerText('#CB213C'),
      })
    ).toEqual([
      { theme: 'light', ratio: 3.75, floor: REEL_BODY_FLOOR },
      { theme: 'dark', ratio: 3.75, floor: REEL_BODY_FLOOR },
    ]);
  });

  test('a player text of #6a6a6a on #0F0000 warns', () => {
    const warnings = reelInkWarnings({
      background: OBB_GROUND,
      tokenOverrides: playerText('#6a6a6a'),
    });
    expect(warnings.map((w) => w.theme)).toEqual(['light', 'dark']);
    for (const { ratio } of warnings) {
      expect(ratio).toBeGreaterThan(3);
      expect(ratio).toBeLessThan(REEL_BODY_FLOOR);
    }
  });

  test("white, the player's own, never warns on a dark ground", () => {
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: playerText('#FFFFFF'),
      })
    ).toEqual([]);
  });

  test('a colour that is not a hex is not judged, as the ground nudge reads none', () => {
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: playerText('rgb(203 33 60)'),
      })
    ).toEqual([]);
  });
});

describe('reelInkWarnings: each theme on its own ground', () => {
  test('only the theme that falls short is named: the dark one here', () => {
    expect(
      reelInkWarnings({
        background: '#FFFFFF',
        backgroundDark: OBB_GROUND,
        darkTokenOverrides: playerText('#CB213C'),
      })
    ).toEqual([{ theme: 'dark', ratio: 3.75, floor: REEL_BODY_FLOOR }]);
  });

  test('and the light one, when only its ground is dark', () => {
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        backgroundDark: '#FFFFFF',
        tokenOverrides: playerText('#CB213C'),
      })
    ).toEqual([{ theme: 'light', ratio: 3.75, floor: REEL_BODY_FLOOR }]);
  });

  test("with no background of its own, the dark theme is judged on the platform's", () => {
    // The light platform ground is light, so only the dark one can warn; a
    // dark background alone paints nothing (`data-org-bg` is the light one).
    for (const backgroundDark of [null, OBB_GROUND]) {
      const warnings = reelInkWarnings({
        backgroundDark,
        tokenOverrides: playerText('#6a6a6a'),
      });
      expect(warnings.map((w) => w.theme)).toEqual(['dark']);
      expect(warnings[0]?.ratio).toBeLessThan(REEL_BODY_FLOOR);
    }
  });
});

describe("reelInkWarnings: the hero colours (the owner's, 2026-11-23: keep it, shade, warn)", () => {
  test('a title is large text: #CB213C on #0F0000 (3.75) clears 3, a darker red does not', () => {
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: { 'hero-title-color': '#CB213C' },
      })
    ).toEqual([]);
    const warned = reelInkWarnings({
      background: OBB_GROUND,
      tokenOverrides: { 'hero-title-color': '#6A0000' },
    });
    expect(warned.map((w) => w.floor)).toEqual([3, 3]);
  });

  test('Content text is read on a light ground too: white on cream warns at 4.5', () => {
    const warned = reelInkWarnings({
      background: '#F5ECD7',
      tokenOverrides: { 'hero-text': '#FFFFFF' },
    });
    expect(warned.length).toBeGreaterThan(0);
    expect(
      warned.every((w) => w.floor === REEL_BODY_FLOOR && w.ratio < 4.5)
    ).toBe(true);
  });

  test("a glass button's label is read on its tint: white on a white tint warns", () => {
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: { 'hero-glass-tint': '#FFFFFF' },
      }).length
    ).toBeGreaterThan(0);
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: {
          'hero-glass-tint': '#FFFFFF',
          'hero-glass-text': '#111111',
        },
      })
    ).toEqual([]);
  });
});

describe('reelInkWarnings: a light ground never warns of the player text', () => {
  const LIGHT_GROUNDS = ['#FFFFFF', '#FAFAFA', '#F5ECD7'];
  const INKS = ['#FFFFFF', '#FFFF00', '#CCCCCC', '#CB213C', '#6A6A6A'];

  test.each(
    LIGHT_GROUNDS
  )('on %s, whatever the player text, in either theme', (ground) => {
    for (const ink of INKS) {
      expect(
        reelInkWarnings({
          background: ground,
          tokenOverrides: playerText(ink),
          darkTokenOverrides: playerText(ink),
        }),
        ink
      ).toEqual([]);
    }
  });
});

describe("reelInkWarnings: the reel's own light/dark switch, light AT the pivot", () => {
  // A light page whose darkest surface is mid grey binds exactly at the pivot
  // (`bindingLuminance`). The reel reads that as LIGHT (`groundPoles`),
  // so the editor must too: read strictly above, grey 120 and
  // 135 were judged dark, and white player text on them was warned of.
  test.each([
    ['grey 120', '#787878'],
    ['grey 135', '#878787'],
  ])('%s binds exactly at the pivot, where the reel reads light: no warning', (_, grey) => {
    const y = groundLuminanceVars({ background: grey })['--brand-ground-y'];
    expect(y).toBe(TEXT_ON_BRAND_LUMINANCE_PIVOT.toFixed(4));
    // The reel's own verdict at that luminance: a light ground's black ink pole.
    expect(groundPoles(Number(y)).ink).toEqual([0, 0, 0]);
    expect(
      reelInkWarnings({
        background: grey,
        tokenOverrides: playerText('#FFFFFF'),
      })
    ).toEqual([]);
  });

  test('just under the pivot the ground is dark, and a failing player text is warned of', () => {
    // #0F0000 binds well under it; the switch is the same one either side.
    const y = Number(
      groundLuminanceVars({ background: OBB_GROUND })['--brand-ground-y']
    );
    expect(y).toBeLessThan(TEXT_ON_BRAND_LUMINANCE_PIVOT);
    expect(groundPoles(y).ink).toEqual([255, 255, 255]);
    expect(
      reelInkWarnings({
        background: OBB_GROUND,
        tokenOverrides: playerText('#CB213C'),
      }).map((w) => w.theme)
    ).toEqual(['light', 'dark']);
  });
});

describe('the platform page grounds', () => {
  const PALETTE = sheet('tokens/colors.css');
  /** A theme's `--color-background`, as the hex its palette reference paints. */
  function themeBackground(theme: 'light' | 'dark'): string | undefined {
    const ref = sheet(`themes/${theme}.css`).match(
      /--color-background:\s*var\((--color-[\w-]+)\)/
    )?.[1];
    return ref
      ? PALETTE.match(
          new RegExp(`${ref}: (#[0-9a-fA-F]{6});`)
        )?.[1]?.toLowerCase()
      : undefined;
  }

  test.each([
    'light',
    'dark',
  ] as const)("%s is the theme's own background", (theme) => {
    expect(PLATFORM_PAGE_GROUND[theme]).toBe(themeBackground(theme));
  });
});
