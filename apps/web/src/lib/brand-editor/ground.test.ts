// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  bindingLuminance,
  CHIP_LUMINANCE,
  glassLuminance,
  groundLuminance,
  groundLuminanceVars,
  ORG_SURFACE_STEPS,
  oklchStep,
  PLATFORM_GROUND_LUMINANCE,
  paintableColour,
  STICKY_GLASS_OPACITY,
} from './ground';
import { relativeLuminance, TEXT_ON_BRAND_LUMINANCE_PIVOT } from './ink';
import { hexToOklch, srgbToHex } from './oklch-math';

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
    // White's hardest light surface is its brand-primary chip, at its bound
    // (0.826, under the #ebebeb tertiary panel's 0.831); in dark its panels
    // all clip to white and the chip binds again, below the sticky glass
    // (#f0f0f0). Black's hardest dark surface is the dark chip's bound, over
    // both the glass (#0f0f0f) and the tertiary panel (#020202).
    expect(luminance('#ebebeb')).toBeGreaterThan(CHIP_LUMINANCE.light);
    expect(luminance('#0f0f0f')).toBeLessThan(CHIP_LUMINANCE.dark);
    expect(groundLuminanceVars({ background: '#ffffff' })).toEqual({
      '--brand-ground-y': CHIP_LUMINANCE.light.toFixed(4),
      '--brand-ground-dark-y': CHIP_LUMINANCE.light.toFixed(4),
    });
    expect(
      groundLuminanceVars({ background: '#FFFFFF', backgroundDark: '#000000' })
    ).toEqual({
      '--brand-ground-y': CHIP_LUMINANCE.light.toFixed(4),
      '--brand-ground-dark-y': CHIP_LUMINANCE.dark.toFixed(4),
    });
    // A cream page's own panels are harder than the chip, which then changes
    // nothing.
    expect(Number(groundLuminance('#E8E0D0', 'light'))).toBeLessThan(
      CHIP_LUMINANCE.light
    );
  });

  test('reads only a background the page would paint', () => {
    expect(groundLuminance(' #000000 ', 'dark')).toBe(
      groundLuminance('#000000', 'dark')
    );
    expect(groundLuminance('000000', 'dark')).toBeUndefined();
    expect(
      groundLuminanceVars({ background: '#FFFFFF', backgroundDark: '101418' })
    ).toEqual(groundLuminanceVars({ background: '#FFFFFF' }));
  });
});

// The -subtle chips' luminance bound holds for every brand. Re-derived on a
// 32-level lattice of brands, painted as the stylesheet paints the chips.
describe('the chips labels sit on', () => {
  type Side = readonly [l: number, k: number];
  const TOKENS = [
    '--color-brand-primary-subtle',
    '--color-interactive-subtle',
  ] as const;

  /**
   * A chip's step `[L, dL, K, dK]` in the guarded `[data-org-brand]` rule and
   * its dark twin: lightness `calc(L - dL * var(--_gw))`, chroma
   * `calc(c * (K + dK * var(--_gw)))`.
   */
  function chipSteps(token: string): number[][] {
    const stepped = new RegExp(
      `${token}: oklch\\(from [^;]+ calc\\(([\\d.]+) - ([\\d.]+) \\* var\\(--_gw\\)\\) calc\\(c \\* \\(([\\d.]+) \\+ ([\\d.]+) \\* var\\(--_gw\\)\\)\\) h\\);`,
      'g'
    );
    return [...ORG_BRAND.matchAll(stepped)].map((m) => m.slice(1).map(Number));
  }

  /** A chip's two sides: light at a `--_gw` of 0, dark at 1. */
  function sides([l, dl, k, dk]: number[]): Record<'light' | 'dark', Side> {
    const at = (n: number) => Number(n.toFixed(4));
    return { light: [l, k], dark: [at(l - dl), at(k + dk)] };
  }

  test.each(
    TOKENS
  )('%s: the light rule and its dark twin step alike', (token) => {
    const steps = chipSteps(token);
    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual(steps[0]);
  });

  const levels = Array.from({ length: 32 }, (_, i) =>
    Math.round((i * 255) / 31)
  );
  /** Each chip's luminance over the lattice, per side. */
  function paint(sides: Record<'light' | 'dark', Side>) {
    const out: Record<'light' | 'dark', number[]> = { light: [], dark: [] };
    for (const r of levels) {
      for (const g of levels) {
        for (const b of levels) {
          const brand = srgbToHex(r, g, b);
          const l = hexToOklch(brand)?.l ?? Number.NaN;
          for (const side of ['light', 'dark'] as const) {
            const [cl, k] = sides[side];
            out[side].push(luminance(oklchStep(brand, cl - l, k) ?? ''));
          }
        }
      }
    }
    return out;
  }

  const [primary, interactive] = TOKENS.map((token) =>
    paint(sides(chipSteps(token)[0] ?? []))
  );

  test('a light chip is never darker, a dark one never lighter, than its bound', () => {
    for (const chips of [primary, interactive]) {
      expect(Math.min(...chips.light)).toBeGreaterThanOrEqual(
        CHIP_LUMINANCE.light
      );
      expect(Math.max(...chips.dark)).toBeLessThanOrEqual(CHIP_LUMINANCE.dark);
    }
    // Tight on the hardest chip, so it costs no link more than it needs.
    expect(Math.min(...primary.light) - CHIP_LUMINANCE.light).toBeLessThan(
      0.01
    );
    expect(CHIP_LUMINANCE.dark - Math.max(...primary.dark)).toBeLessThan(0.002);
  });
});

describe('a background or brand colour the page may paint', () => {
  test.each([
    ['#fff', '#fff'],
    ['#FFF8E7', '#FFF8E7'],
    // Painted as the canonical form the nudge measures, never as stored.
    [' #1e1e2e ', '#1e1e2e'],
  ])('is one this module measures: %j', (colour, painted) => {
    expect(paintableColour(colour)).toBe(painted);
  });

  test.each([
    'rgb(30 30 46)',
    'navy',
    'var(--x)',
    'oklch(0.2 0.02 280)',
    // Past sRGB, so past the chip bound too.
    'oklch(0.6 0.4 0)',
    'color(display-p3 1 0 0.4)',
    '#12345',
    // CSS cannot paint a bare hex; the nudge cannot read an 8-digit one.
    '112233',
    '#11223344',
    '',
    null,
    undefined,
    // The dark overrides are free JSON: a value need not be a string.
    123,
    true,
    { hex: '#ffffff' },
  ])('is not anything else: %s', (colour) => {
    expect(paintableColour(colour)).toBeUndefined();
  });
});

// Owner, Codex-mik4h: "Brand text, glass at 94%". The sticky subscribe bar's
// glass is a surface its eyebrow and any link must read on.
describe('the sticky glass', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '../..');
  test.each([
    'lib/components/subscription/SubscribeStickyBar.svelte',
    'routes/_org/[slug]/(space)/pricing/+page.svelte',
  ])('is the opacity %s paints', (path) => {
    const css = readFileSync(join(src, path), 'utf8');
    const rule = css.match(/\.sticky-bar__inner \{[^}]*\}/)?.[0] ?? '';
    const opacity = rule.match(
      /color-mix\(in srgb, var\(--color-surface\) (\d+)%, transparent\)/
    )?.[1];
    expect(Number(opacity) / 100).toBe(STICKY_GLASS_OPACITY);
  });

  test('never binds on the platform: its fallbacks are its panels', () => {
    expect(glassLuminance('#ffffff')).toBeGreaterThan(
      PLATFORM_GROUND_LUMINANCE.light
    );
    expect(glassLuminance('#262626')).toBeLessThan(
      PLATFORM_GROUND_LUMINANCE.dark
    );
  });
});
