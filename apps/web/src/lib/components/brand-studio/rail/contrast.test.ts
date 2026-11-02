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
  // The step's steepness as the stylesheets write it (a string: `${1e9}` would
  // print 1000000000).
  const RAMP = '1e9';
  // One channel of an ink, built from the pivot the readout uses.
  const CHANNEL = `calc(255 * clamp(0, (${TEXT_ON_BRAND_LUMINANCE_PIVOT} - (0.2126 * pow((r / 255 + 0.055) / 1.055, 2.4) + 0.7152 * pow((g / 255 + 0.055) / 1.055, 2.4) + 0.0722 * pow((b / 255 + 0.055) / 1.055, 2.4))) * ${RAMP}, 1))`;
  const GUARD =
    '@supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0))';
  const count = (css: string, text: string) => css.split(text).length - 1;

  // The step is written out once per channel, many times a file, so every
  // copy is checked: one drifted copy would hide behind any intact one.
  function expectEveryChannelIsTheStep(css: string, label: string) {
    const channels = count(css, 'calc(255 * clamp(0, ');
    expect(channels, label).toBeGreaterThan(0);
    expect(count(css, CHANNEL), label).toBe(channels);
  }

  test('org-brand.css chooses the org’s inks by the same luminance step', () => {
    const css = readFileSync(join(styles, 'tokens/org-brand.css'), 'utf8');
    expectEveryChannelIsTheStep(css, 'org-brand.css');
    expect(css).toContain('--color-text-on-brand: rgb(');
  });

  test('the platform themes choose theirs by it too, under the same guard', () => {
    for (const theme of ['light', 'dark']) {
      const css = readFileSync(join(styles, `themes/${theme}.css`), 'utf8');
      const start = css.indexOf(GUARD);
      expect(start, theme).toBeGreaterThan(-1);
      const guarded = css.slice(start);
      expectEveryChannelIsTheStep(guarded, theme);
      expect(count(guarded, CHANNEL), theme).toBe(6);
      expect(guarded, theme).toContain('--color-on-interactive: rgb(');
      expect(guarded, theme).toContain('--color-text-on-accent: rgb(');
    }
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

  test('no 8-bit colour sits inside the step’s ramp, so every ink is pure', () => {
    // The counter can see the defect: at `* 1e6` 32 colours were inside,
    // #b747b5 among them, painted grey at about 1.07:1.
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
