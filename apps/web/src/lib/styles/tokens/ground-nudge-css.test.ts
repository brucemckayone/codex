// @vitest-environment node
/**
 * org-brand.css nudges links and focus colours against the hardest ground
 * they sit on (Codex-mik4h). The fragments are generated here, from the same floors the
 * brand studio's pill reports with (`ground-nudge.ts`); the test fails if the
 * stylesheet's text drifts from them, so the page and the pill cannot
 * disagree about what was moved.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { PLATFORM_GROUND_LUMINANCE } from '$lib/brand-editor/ground';
import { LINK_FLOOR, MARK_FLOOR } from '$lib/brand-editor/ground-nudge';
import { TEXT_ON_BRAND_LUMINANCE_PIVOT } from '$lib/brand-editor/ink';

const here = dirname(fileURLToPath(import.meta.url));
const ORG_BRAND = readFileSync(join(here, 'org-brand.css'), 'utf8');
const GUARD =
  '@supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0))';
const GUARDED = ORG_BRAND.slice(ORG_BRAND.indexOf(GUARD));
const count = (css: string, text: string) => css.split(text).length - 1;

/**
 * One family of fragments: the colour in `rgb(from COLOUR …)`, moved in
 * linear light to the family's target luminance `--_X-t` on the ground
 * `--_gy`. Darkened (`-dk`, a scale down) on a light ground, lightened on a
 * dark one (`-s` scales up, each channel capped at 1; `-k` mixes toward white
 * for what the cap left short); `--_gw` picks the side. ground-nudge.ts does
 * the same arithmetic.
 */
function nudgeFragments(x: string, floor: number): string[] {
  const lin = (c: string) => `var(--_lin-${c})`;
  const t = `var(--_${x}-t)`;
  return [
    `--_${x}-t: calc(var(--_gw) * min(1, ${floor} * (var(--_gy) + 0.05) - 0.05) + (1 - var(--_gw)) * max(0, (var(--_gy) + 0.05) / ${floor} - 0.05));`,
    `--_${x}-dk: min(1, ${t} / max(var(--_lum), 1e-6));`,
    `--_${x}-s: max(1, ${t} / max(var(--_lum), 1e-6));`,
    ...['r', 'g', 'b'].map(
      (c) => `--_${x}-1${c}: min(1, ${lin(c)} * var(--_${x}-s));`
    ),
    `--_${x}-y1: (0.2126 * var(--_${x}-1r) + 0.7152 * var(--_${x}-1g) + 0.0722 * var(--_${x}-1b));`,
    `--_${x}-k: max(0, (${t} - var(--_${x}-y1)) / max(1 - var(--_${x}-y1), 1e-6));`,
    ...['r', 'g', 'b'].map(
      (c) =>
        `--_${x}-${c}: max(0, 255 * (1.055 * pow(var(--_gw) * (var(--_${x}-1${c}) + var(--_${x}-k) * (1 - var(--_${x}-1${c}))) + (1 - var(--_gw)) * ${lin(c)} * var(--_${x}-dk), 1 / 2.4) - 0.055));`
    ),
  ];
}

const channels = (x: string) =>
  `var(--_${x}-r) var(--_${x}-g) var(--_${x}-b));`;
const NUDGED = [
  `--color-link: rgb(from var(--color-interactive) ${channels('gl')}`,
  `--color-link-hover: rgb(from var(--color-interactive-hover) ${channels('gl')}`,
  `--color-link-active: rgb(from var(--color-interactive-active) ${channels('gl')}`,
  `--color-focus: rgb(from var(--_focus-src) ${channels('gm')}`,
  `--color-focus-ring: rgb(from var(--_focus-ring-src) ${channels('gm')}`,
  `--color-border-focus: rgb(from var(--_focus-src) ${channels('gm')}`,
];

describe('the ground nudge org-brand.css paints', () => {
  test('its fragments are the generated ones, at the pill’s floors, written once', () => {
    for (const line of [
      ...nudgeFragments('gl', LINK_FLOOR),
      ...nudgeFragments('gm', MARK_FLOOR),
    ]) {
      expect(count(GUARDED, line), line).toBe(1);
    }
  });

  test('the ground is the number the writers emit, else the platform’s, per theme', () => {
    expect(
      count(
        GUARDED,
        `--_gy: var(--brand-ground-y, ${PLATFORM_GROUND_LUMINANCE.light});`
      )
    ).toBe(1);
    expect(
      count(
        GUARDED,
        `--_gy: var(--brand-ground-dark-y, ${PLATFORM_GROUND_LUMINANCE.dark});`
      )
    ).toBe(1);
    expect(
      count(
        GUARDED,
        `--_gw: clamp(0, (${TEXT_ON_BRAND_LUMINANCE_PIVOT} - var(--_gy)) * 1e12, 1);`
      )
    ).toBe(1);
  });

  test('links and focus colours are nudged in both themes', () => {
    // The dark twin restates them: the dark fallbacks out-rank the light rule.
    for (const declaration of NUDGED)
      expect(count(GUARDED, declaration), declaration).toBe(2);
  });

  test('a fine-tune focus colour is an input to the nudge, in both themes', () => {
    expect(count(ORG_BRAND, '--_focus-src: var(--brand-focus, ')).toBe(2);
    expect(
      count(ORG_BRAND, '--_focus-ring-src: var(--brand-focus-ring, ')
    ).toBe(2);
  });

  test('outside the guard, links are the interactive colour and focus is its source', () => {
    const fallback = ORG_BRAND.slice(0, ORG_BRAND.indexOf(GUARD));
    expect(count(fallback, '--color-link: var(--color-interactive);')).toBe(1);
    expect(
      count(fallback, '--color-link-active: var(--color-interactive-active);')
    ).toBe(1);
    expect(count(fallback, '--color-focus: var(--_focus-src);')).toBe(2);
  });
});
