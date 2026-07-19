/**
 * Contrast helper tests (Codex-cijzb · WP-1.5).
 *
 * The maths is small and load-bearing (the rail's AA warning depends on it), so
 * it is proven directly. Assertions are unconditional and the failing-AA case
 * is a genuine failure — if `deriveTextOnBrand` picked the wrong foreground the
 * verdict would flip and the test would break.
 */
import { describe, expect, test } from 'vitest';
import {
  AA_CONTRAST_THRESHOLD,
  contrastRatio,
  deriveTextOnBrand,
  evaluateBrandContrast,
  formatContrastRatio,
  relativeLuminance,
} from './contrast';

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

describe('deriveTextOnBrand (mirrors org-brand.css l < 0.62 pivot)', () => {
  test('picks black text on a light brand colour', () => {
    expect(deriveTextOnBrand('#FFFFFF')).toBe('#000000');
    expect(deriveTextOnBrand('#FDE68A')).toBe('#000000'); // light amber
  });

  test('picks white text on a dark brand colour', () => {
    expect(deriveTextOnBrand('#000000')).toBe('#FFFFFF');
    expect(deriveTextOnBrand('#1A1A2E')).toBe('#FFFFFF'); // deep navy
  });

  test('falls back to white for an unparseable brand hex', () => {
    expect(deriveTextOnBrand('not-a-colour')).toBe('#FFFFFF');
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

  test('mid-grey #808080 FAILS AA — auto-contrast picks white but 3.95:1 < 4.5:1', () => {
    const result = evaluateBrandContrast('#808080');
    // The pivot puts this just below 0.62 → white text is chosen…
    expect(result.text).toBe('#FFFFFF');
    // …but white-on-mid-grey is below the AA floor, so the rail must warn.
    expect(result.ratio).not.toBeNull();
    expect(result.ratio as number).toBeLessThan(AA_CONTRAST_THRESHOLD);
    expect(result.passesAA).toBe(false);
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
