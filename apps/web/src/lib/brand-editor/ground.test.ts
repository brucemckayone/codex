// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  bindingLuminance,
  groundLuminance,
  groundLuminanceVars,
  ORG_SURFACE_STEPS,
  PLATFORM_GROUND_LUMINANCE,
  paintableBackground,
} from './ground';
import { relativeLuminance, TEXT_ON_BRAND_LUMINANCE_PIVOT } from './ink';

const styles = join(dirname(fileURLToPath(import.meta.url)), '../styles');
const sheet = (path: string) =>
  readFileSync(join(styles, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const PALETTE = sheet('tokens/colors.css');
const THEMES = {
  light: sheet('themes/light.css'),
  dark: sheet('themes/dark.css'),
};
const ORG_BRAND = sheet('tokens/org-brand.css');

/** A theme value as the hex it paints: a palette reference, its fallback, or a literal. */
function paletteHex(value: string): string {
  const ref = value.match(/^var\((--color-[\w-]+)(?:,\s*(#[0-9a-f]{6}))?\)$/i);
  if (!ref) return value;
  const found = PALETTE.match(new RegExp(`${ref[1]}: (#[0-9a-fA-F]{6});`))?.[1];
  const hex = found ?? ref[2];
  if (!hex) throw new Error(`${ref[1]} is not in the palette`);
  return hex;
}

/** The surfaces a theme file declares first, by name. */
function platformSurfaces(theme: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of THEMES[theme].matchAll(
    /(--color-(?:background|surface[\w-]*)):\s*([^;]+);/g
  )) {
    out[name] ??= value.trim();
  }
  return out;
}

const luminance = (hex: string) => relativeLuminance(hex) ?? Number.NaN;

describe('the platform grounds', () => {
  test.each([
    ['light', '#e5e5e5'],
    ['dark', '#525252'],
  ] as const)('%s binds on its hardest surface, %s', (theme, hardest) => {
    const declared = platformSurfaces(theme);
    // Every ground the theme declares is one this module weighs, bar the scrim.
    const grounds = Object.keys(declared).filter(
      (name) => name !== '--color-surface-overlay'
    );
    expect(grounds.sort()).toEqual(
      Object.keys(ORG_SURFACE_STEPS[theme]).sort()
    );
    const page = luminance(paletteHex(declared['--color-background']));
    const surfaces = grounds.map((name) =>
      luminance(paletteHex(declared[name]))
    );
    const binding = bindingLuminance(page, surfaces);
    expect(binding).toBeCloseTo(luminance(hardest), 6);
    expect(PLATFORM_GROUND_LUMINANCE[theme]).toBe(Number(binding.toFixed(4)));
  });
});

describe('the surfaces painted from an org’s ground', () => {
  const GROUND = {
    light: 'var(--brand-bg, white)',
    dark: 'var(--brand-bg-dark, var(--brand-bg, #1a1a2e))',
  };
  /** The `[data-org-bg]` rule of a theme that paints the page from the org's ground. */
  function surfaceRule(theme: 'light' | 'dark'): string {
    const rules = [...ORG_BRAND.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector, body]) =>
        selector.includes('[data-org-bg]') &&
        selector.includes('dark') === (theme === 'dark') &&
        body.includes('--color-background:')
    );
    expect(rules).toHaveLength(1);
    return rules[0][2];
  }

  test.each([
    'light',
    'dark',
  ] as const)('%s: every step is the stylesheet’s', (theme) => {
    const ground = GROUND[theme].replace(/[()]/g, '\\$&');
    const stepped = new RegExp(
      `^oklch\\(from ${ground} calc\\(l ([+-]) ([\\d.]+)\\) calc\\(c \\* ([\\d.]+)\\) h\\)$`
    );
    const steps: Record<string, readonly [number, number]> = {};
    for (const [, name, raw] of surfaceRule(theme).matchAll(
      /(--color-(?:background|surface[\w-]*)):\s*([^;]+);/g
    )) {
      const value = raw.trim();
      if (name === '--color-surface-overlay') continue;
      if (value === GROUND[theme]) {
        steps[name] = [0, 1];
        continue;
      }
      const step = value.match(stepped);
      expect(step, `${theme} ${name}: ${value}`).not.toBeNull();
      const [, sign, dl, k] = step as RegExpMatchArray;
      steps[name] = [Number(`${sign}${dl}`), Number(k)];
    }
    expect(steps).toEqual(ORG_SURFACE_STEPS[theme]);
  });
});

describe('the binding surface', () => {
  const pivot = TEXT_ON_BRAND_LUMINANCE_PIVOT;

  test('is the darkest on a light page and the lightest on a dark one', () => {
    expect(bindingLuminance(0.9, [0.95, 0.8, 0.85])).toBe(0.8);
    expect(bindingLuminance(0.01, [0.02, 0.05, 0.03])).toBe(0.05);
  });

  test('stays on the page’s side of the pivot, which the stylesheet reads the direction from', () => {
    expect(bindingLuminance(0.2, [0.15])).toBe(pivot);
    expect(bindingLuminance(0.17, [0.2])).toBeLessThan(pivot);
    // A mid grey's darkest panel crosses the pivot: it binds AT it, written
    // as the number the stylesheet's step reads as light (0) and dark (1).
    expect(luminance('#787878')).toBeGreaterThan(pivot);
    expect(groundLuminance('#787878', 'light')).toBe('0.1791');
    expect(luminance('#747474')).toBeLessThan(pivot);
    expect(groundLuminance('#747474', 'dark')).toBe('0.1790');
  });
});

describe('the inputs an org’s backgrounds write', () => {
  test('nothing when the org paints no ground of its own', () => {
    expect(groundLuminanceVars({})).toEqual({});
    expect(
      groundLuminanceVars({ background: null, backgroundDark: '#101010' })
    ).toEqual({});
    expect(groundLuminanceVars({ background: 'not-a-colour' })).toEqual({});
  });

  test('each theme’s hardest surface, from the dark background, else the light one', () => {
    // White's darkest light panel is the tertiary, oklch(0.94 0 0) = #ebebeb;
    // its dark surfaces all clip to white. Black's lightest dark panel is the
    // tertiary, oklch(0.08 0 0) = #020202.
    expect(groundLuminanceVars({ background: '#ffffff' })).toEqual({
      '--brand-ground-y': luminance('#ebebeb').toFixed(4),
      '--brand-ground-dark-y': '1.0000',
    });
    expect(
      groundLuminanceVars({ background: '#FFFFFF', backgroundDark: '#000000' })
    ).toEqual({
      '--brand-ground-y': luminance('#ebebeb').toFixed(4),
      '--brand-ground-dark-y': luminance('#020202').toFixed(4),
    });
  });
});

// Owner, Codex-mik4h: "Ignore it, like On Brand". The writers paint only a
// background this module can measure, so the page and its nudge agree.
describe('a background the page may paint', () => {
  test.each([
    '#fff',
    '#FFF8E7',
    ' #1e1e2e ',
  ])('is one this module measures: %s', (colour) => {
    expect(paintableBackground(colour)).toBe(colour);
  });

  test.each([
    'rgb(30 30 46)',
    'navy',
    'var(--x)',
    'oklch(0.2 0.02 280)',
    '#12345',
    '',
    null,
    undefined,
  ])('is not anything else: %s', (colour) => {
    expect(paintableBackground(colour)).toBeUndefined();
  });
});
