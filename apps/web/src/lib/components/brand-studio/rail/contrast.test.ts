/**
 * Contrast helper tests (Codex-cijzb · WP-1.5).
 *
 * The maths is small and load-bearing (the rail's AA readout depends on it), so
 * it is proven directly. `deriveTextOnBrand` must pick the ink the product
 * paints (Codex-6r63f): if it picked the other, the green cases below would
 * read the weaker ink and the verdicts would flip.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  AA_CONTRAST_THRESHOLD,
  contrastRatio,
  deriveTextOnBrand,
  evaluateBrandContrast,
  formatContrastRatio,
  relativeLuminance,
  TEXT_ON_BRAND_LUMINANCE_PIVOT,
} from './contrast';

/** 16 levels a channel: 4 096 brands across the whole sRGB cube. */
function everyBrand(): string[] {
  const levels = Array.from({ length: 16 }, (_, i) =>
    (i * 17).toString(16).padStart(2, '0')
  );
  return levels.flatMap((r) =>
    levels.flatMap((g) => levels.map((b) => `#${r}${g}${b}`))
  );
}

describe('relativeLuminance', () => {
  test('black is 0 and white is 1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  test('returns null for malformed hex', () => {
    expect(relativeLuminance('nope')).toBeNull();
    expect(relativeLuminance('#12')).toBeNull();
  });
});

describe('contrastRatio', () => {
  test('black on white is the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  test('identical colours are 1:1', () => {
    expect(contrastRatio('#3B82F6', '#3B82F6')).toBeCloseTo(1, 5);
  });

  test('is order-independent', () => {
    const a = contrastRatio('#808080', '#FFFFFF');
    const b = contrastRatio('#FFFFFF', '#808080');
    expect(a).not.toBeNull();
    expect(a).toBeCloseTo(b as number, 5);
  });

  test('returns null when a colour is unparseable', () => {
    expect(contrastRatio('#FFFFFF', 'oops')).toBeNull();
  });
});

describe('deriveTextOnBrand (mirrors org-brand.css’s luminance step)', () => {
  test('picks black text on a light brand colour', () => {
    expect(deriveTextOnBrand('#FFFFFF')).toBe('#000000');
    expect(deriveTextOnBrand('#FDE68A')).toBe('#000000'); // light amber
  });

  test('picks white text on a dark brand colour', () => {
    expect(deriveTextOnBrand('#000000')).toBe('#FFFFFF');
    expect(deriveTextOnBrand('#1A1A2E')).toBe('#FFFFFF'); // deep navy
  });

  // The band the old OKLCH lightness step misjudged: it put white on these.
  test('picks black on a mid-lightness saturated green, as the product paints', () => {
    expect(deriveTextOnBrand('#059669')).toBe('#000000');
    expect(contrastRatio('#059669', '#000000') as number).toBeCloseTo(5.57, 2);
    expect(deriveTextOnBrand('#01A221')).toBe('#000000');
  });

  test('falls back to white for an unparseable brand hex', () => {
    expect(deriveTextOnBrand('not-a-colour')).toBe('#FFFFFF');
  });

  // CSS refuses a colour with one bad digit, so the readout must too: it once
  // read `#ffff0g` as yellow, from the digits before the bad one.
  test('reads a hex with one bad digit as no colour at all', () => {
    expect(relativeLuminance('#ffff0g')).toBeNull();
    expect(evaluateBrandContrast('#ffff0g').ratio).toBeNull();
    expect(relativeLuminance('#fg0')).toBeNull();
  });

  // Where white and black contrast equally, so the better of the two clears
  // AA on every brand (org-brand.css's foot).
  test('flips where white and black contrast equally', () => {
    expect(TEXT_ON_BRAND_LUMINANCE_PIVOT).toBeCloseTo(
      Math.sqrt(1.05 * 0.05) - 0.05,
      4
    );
  });

  test('clears AA on every brand of a 4 096-colour lattice of the sRGB cube', () => {
    let floor = Number.POSITIVE_INFINITY;
    const failing: string[] = [];
    for (const brand of everyBrand()) {
      const { ratio, passesAA } = evaluateBrandContrast(brand);
      floor = Math.min(floor, ratio as number);
      if (!passesAA) failing.push(brand);
    }
    expect(failing).toEqual([]);
    expect(floor).toBeGreaterThanOrEqual(4.57);
  });
});

// The readout is only honest while it computes what the stylesheets do.
describe('the rule the stylesheets paint', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const styles = join(here, '../../../styles');
  // The step's steepness as the stylesheets write it (a string: `${1e12}`
  // would print 1000000000000).
  const RAMP = '1e12';
  // The step, written once at themes/light.css's foot, built from the pivot
  // the readout uses, over the luminance terms written beside it. Each channel
  // is clamped to the gamut first, so a hovered fill pushed past black or
  // white still has a luminance (unclamped, 1 605 of the lattice's 8 192
  // hovered fills took a NaN and black ink, 878 of them where white was
  // needed, as low as 1.11:1; 15 dark ones lightened past 255 took the wrong
  // ink, as low as 4.21:1).
  const linear = (c: string) =>
    `--_lin-${c}: pow((clamp(0, ${c}, 255) / 255 + 0.055) / 1.055, 2.4);`;
  const STEP = [
    linear('r'),
    linear('g'),
    linear('b'),
    '--_lum: (0.2126 * var(--_lin-r) + 0.7152 * var(--_lin-g) + 0.0722 * var(--_lin-b));',
    `--_on-fill-step: clamp(0, (${TEXT_ON_BRAND_LUMINANCE_PIVOT} - var(--_lum)) * ${RAMP}, 1);`,
  ];
  // Colours nudged against the page (Codex-mik4h) are declared in the same
  // guarded blocks but are not inks; ground-nudge-css.test.ts pins them.
  const NUDGED = [
    '--color-link',
    '--color-link-hover',
    '--color-focus',
    '--color-focus-ring',
    '--color-border-focus',
  ];
  const S = 'calc(255 * var(--_on-fill-step))';
  const GUARD =
    '@supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0))';
  // Every ink chosen from a fill, in every scope that declares the fills.
  const INKS = [
    '--color-text-on-brand',
    '--color-text-on-brand-hover',
    '--color-on-interactive',
    '--color-on-interactive-hover',
    '--color-on-interactive-active',
    '--color-text-on-accent',
    '--color-text-on-accent-hover',
  ];
  const count = (css: string, text: string) => css.split(text).length - 1;

  function guarded(file: string): string {
    const css = readFileSync(join(styles, file), 'utf8');
    const start = css.indexOf(GUARD);
    expect(start, file).toBeGreaterThan(-1);
    return css.slice(start);
  }

  // Each ink must be `rgb(from FILL S S S)`: the step on all three channels,
  // and nothing else.
  function expectEveryInkIsTheStep(
    block: string,
    file: string,
    scopes: number
  ) {
    const inks = (
      block.match(/--color-[a-z-]+: rgb\(from [^;]+\);/g) ?? []
    ).filter(
      (declaration) =>
        !NUDGED.some((name) => declaration.startsWith(`${name}:`))
    );
    for (const ink of inks) expect(ink, file).toMatch(`${S} ${S} ${S});`);
    for (const name of INKS)
      expect(count(block, `${name}: rgb(from `), `${file} ${name}`).toBe(
        scopes
      );
    expect(inks.length, file).toBe(INKS.length * scopes);
    // No written-out copy of the step is left to drift.
    expect(count(block, 'calc(255 * clamp(0, '), file).toBe(0);
  }

  test('the step is written once, at light.css’s foot, from the readout’s pivot', () => {
    for (const line of STEP)
      expect(count(guarded('themes/light.css'), line), line).toBe(1);
    for (const file of ['themes/dark.css', 'tokens/org-brand.css'])
      for (const name of ['--_on-fill-step:', '--_lum:', '--_lin-r:'])
        expect(count(guarded(file), name), `${file} ${name}`).toBe(0);
  });

  test('org-brand.css chooses the org’s inks by it, light and dark', () => {
    expectEveryInkIsTheStep(
      guarded('tokens/org-brand.css'),
      'org-brand.css',
      2
    );
  });

  test('the platform themes choose theirs by it too, under the same guard', () => {
    expectEveryInkIsTheStep(guarded('themes/light.css'), 'light.css', 1);
    expectEveryInkIsTheStep(guarded('themes/dark.css'), 'dark.css', 1);
  });

  // `clamp(0, (pivot - Y) * m, 1)` is a ramp 1/m wide, and a fill inside it
  // is painted a GREY ink while the readout reports white. Counted over every
  // 8-bit colour, in the stylesheets' own luminance and summation order.
  function coloursInsideTheRamp(multiplier: number): number {
    const levels = Array.from(
      { length: 256 },
      (_, c) => ((c / 255 + 0.055) / 1.055) ** 2.4
    );
    const red = levels.map((level) => 0.2126 * level);
    const green = levels.map((level) => 0.7152 * level);
    const blue = levels.map((level) => 0.0722 * level);
    let inside = 0;
    for (const yr of red)
      for (const yg of green)
        for (const yb of blue) {
          const ramp =
            (TEXT_ON_BRAND_LUMINANCE_PIVOT - (yr + yg + yb)) * multiplier;
          if (ramp > 0 && ramp < 1) inside++;
        }
    return inside;
  }

  // This proves the double-precision model. Engines compute Y about 1e-8 away
  // from it, so the stylesheets' ramp is kept ten thousand times narrower than
  // that, and WebKit 26 and Chrome 156 were measured painting no grey at it.
  test('no 8-bit colour sits inside the step’s ramp, so every ink is pure', () => {
    // The counter can see the defect: at `* 1e6` 32 colours were inside,
    // #b747b5 among them, measured grey at 1.03:1 (WebKit) and 1.15:1 (Chrome).
    expect(coloursInsideTheRamp(1e6)).toBe(32);
    expect(coloursInsideTheRamp(Number(RAMP))).toBe(0);
  });
});

describe('evaluateBrandContrast', () => {
  test('a strong dark brand passes AA', () => {
    const result = evaluateBrandContrast('#1D4ED8'); // deep blue
    expect(result.text).toBe('#FFFFFF');
    expect(result.ratio).not.toBeNull();
    expect(result.ratio as number).toBeGreaterThanOrEqual(
      AA_CONTRAST_THRESHOLD
    );
    expect(result.passesAA).toBe(true);
  });

  // The old lightness step put white on a plain mid grey, at 3.95:1; the
  // luminance step paints black, and the readout says so (Codex-6r63f).
  test('mid-grey #808080 passes AA: the product paints black on it, 5.32:1', () => {
    const result = evaluateBrandContrast('#808080');
    expect(result.text).toBe('#000000');
    expect(result.ratio as number).toBeCloseTo(5.32, 2);
    expect(result.passesAA).toBe(true);
  });

  test('reports null ratio + failing verdicts for a bad hex', () => {
    const result = evaluateBrandContrast('#zzz');
    expect(result.ratio).toBeNull();
    expect(result.passesAA).toBe(false);
    expect(result.passesAAA).toBe(false);
  });
});

describe('formatContrastRatio', () => {
  test('formats to two decimals with a :1 suffix', () => {
    expect(formatContrastRatio(4.5)).toBe('4.50:1');
    expect(formatContrastRatio(21)).toBe('21.00:1');
  });

  test('renders an em dash for null', () => {
    expect(formatContrastRatio(null)).toBe('—');
  });
});
