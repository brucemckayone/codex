// @vitest-environment node
/**
 * Brand-tinted text that must stay readable holds AA for every brand
 * (Codex-mik4h).
 *
 * Two derivations tint text from the org's brand colour, and both failed for
 * a pale or a dark brand until each was held at an OKLCH lightness:
 *   - the org hero's default button label, the brand mixed 75% with black on
 *     the white default button (a pale brand: 2.74:1), held at `min(l, X)`;
 *   - `--color-text-tertiary` for an org without its own background, held at
 *     `min(…, X)` in light (pale brands 2.1:1) and `max(…, X)` in dark (all
 *     three seeded orgs failed, OBB 3.54:1).
 *
 * The holds are read from the stylesheets and run through a model of the
 * engines' resolution (OKLCH to sRGB, clipped to the gamut). The model was
 * calibrated against Chrome 156 and WebKit 26 painting the real stylesheets
 * over the same 4 096-colour lattice: identical worst cases, and failure
 * counts within a few colours at each boundary. A hold loosened in the CSS
 * fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

type Rgb = [number, number, number];

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, path), 'utf8');
const ORG_BRAND = read('org-brand.css');
const LANDING = read('../../../routes/_org/[slug]/(space)/+page.svelte');

const lin = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function toOklch([r8, g8, b8]: Rgb): Rgb {
  const r = lin(r8 / 255);
  const g = lin(g8 / 255);
  const b = lin(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH to 8-bit sRGB, clipped to the gamut as the engines paint it. */
function toRgb([L, C, H]: Rgb): Rgb {
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const channel = (c: number) =>
    Math.round(255 * gamma(Math.min(1, Math.max(0, c))));
  return [
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function ratio(a: Rgb, b: Rgb): number {
  const luminance = ([r, g, b]: Rgb) =>
    0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 16 levels a channel: 4 096 brands across the whole sRGB cube. */
const LEVELS = Array.from({ length: 16 }, (_, i) => i * 17);
const BRANDS: Rgb[] = LEVELS.flatMap((r) =>
  LEVELS.flatMap((g) => LEVELS.map((b): Rgb => [r, g, b]))
);

/** How many brands' text falls under AA on any of the grounds, and the worst. */
function sweep(text: (brand: Rgb) => Rgb, grounds: Rgb[]) {
  let under = 0;
  let worst = Number.POSITIVE_INFINITY;
  for (const brand of BRANDS) {
    const ink = text(brand);
    const r = Math.min(...grounds.map((ground) => ratio(ink, ground)));
    if (r < 4.5) under++;
    worst = Math.min(worst, r);
  }
  return { under, worst };
}

/** The number a hold is written with, read from the stylesheet. */
function hold(source: string, pattern: RegExp, label: string): number {
  const found = source.match(pattern);
  expect(found, label).not.toBeNull();
  return Number(found?.[1]);
}

const WHITE: Rgb = [255, 255, 255];
// The platform grounds an org without its own background sits on.
const LIGHT_GROUNDS: Rgb[] = [[250, 250, 250], WHITE];
const DARK_GROUNDS: Rgb[] = [
  [23, 23, 23],
  [38, 38, 38],
];

describe('brand-tinted text that must stay readable', () => {
  test('the hero’s default button label clears AA on the white button for every brand', () => {
    const x = hold(
      LANDING,
      /--brand-hero-cta-text, oklch\(from color-mix\(in oklch, var\(--color-brand-primary\) 75%, black\) min\(l, ([\d.]+)\) c h\)\)/,
      'the hero label hold'
    );
    const label = (unheld: boolean) => (brand: Rgb) => {
      const [L, C, H] = toOklch(brand);
      return toRgb([unheld ? 0.75 * L : Math.min(0.75 * L, x), 0.75 * C, H]);
    };
    // The mix alone failed, so the model can see the defect.
    expect(sweep(label(true), [WHITE]).under).toBeGreaterThan(1000);
    const held = sweep(label(false), [WHITE]);
    expect(held.under).toBe(0);
    expect(held.worst).toBeGreaterThanOrEqual(4.5);
  });

  test('tertiary text clears AA on the light page and surface for every brand', () => {
    const x = hold(
      ORG_BRAND,
      /--color-text-tertiary: oklch\(from var\(--brand-color, var\(--color-primary-500\)\) min\(calc\(l \* 0\.6 \+ 0\.2\), ([\d.]+)\) calc\(c \* 0\.1\) h\);/,
      'the light tertiary hold'
    );
    const text = (cap: number) => (brand: Rgb) => {
      const [L, C, H] = toOklch(brand);
      return toRgb([Math.min(L * 0.6 + 0.2, cap), C * 0.1, H]);
    };
    expect(sweep(text(1), LIGHT_GROUNDS).under).toBeGreaterThan(1000);
    const held = sweep(text(x), LIGHT_GROUNDS);
    expect(held.under).toBe(0);
    expect(held.worst).toBeGreaterThanOrEqual(4.5);
  });

  test('tertiary text clears AA on the dark page and surface for every brand', () => {
    const x = hold(
      ORG_BRAND,
      /--color-text-tertiary: oklch\(from var\(--brand-color-dark, var\(--brand-color, var\(--color-primary-400\)\)\) max\(calc\(l \* 0\.5 \+ 0\.3\), ([\d.]+)\) calc\(c \* 0\.1\) h\);/,
      'the dark tertiary hold'
    );
    const text = (floor: number) => (brand: Rgb) => {
      const [L, C, H] = toOklch(brand);
      return toRgb([Math.max(L * 0.5 + 0.3, floor), C * 0.1, H]);
    };
    expect(sweep(text(0), DARK_GROUNDS).under).toBeGreaterThan(1000);
    const held = sweep(text(x), DARK_GROUNDS);
    expect(held.under).toBe(0);
    expect(held.worst).toBeGreaterThanOrEqual(4.5);
  });
});
