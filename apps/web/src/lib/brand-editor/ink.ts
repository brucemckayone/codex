/**
 * Ink on a filled colour (Codex-6r63f): the one TypeScript copy of the rule
 * the stylesheets paint, plus the WCAG contrast maths it is judged by.
 *
 * `org-brand.css` (the `@supports` block at its foot) and the platform themes
 * choose the text on a brand fill by its relative LUMINANCE: pure white below
 * 0.1791, where white and black contrast equally (each 4.58:1), pure black at
 * or above. Chosen that way, the label clears AA on every sRGB colour: the
 * floor is 4.57:1. (It is a true step only because its ramp, `* 1e9`, is
 * narrower than any 8-bit colour's distance from the pivot; the tests sweep
 * that.) An engine that fails the stylesheets' `@supports` test (org-brand.css
 * records Chrome before 125) keeps their older fallback, an OKLCH lightness
 * step at 0.62, which picks the weaker ink for some greens and teals. This
 * module models what every current browser paints, not that fallback.
 *
 * A leaf with no imports, so that both sides can use it: the `$lib/brand-editor`
 * barrel re-exports `preset-axes.ts`, which uses this maths, and must not pull
 * in component-tree code; the brand studio's contrast pill (`rail/contrast.ts`)
 * reads it to report the ink the page really paints.
 */

/** Relative luminance where the ink flips white → black: sqrt(1.05 * 0.05) - 0.05. */
export const TEXT_ON_BRAND_LUMINANCE_PIVOT = 0.1791;

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/**
 * A #RGB or #RRGGBB hex string as 0–255 channels, or null. Strict, as CSS is:
 * a colour with one bad digit is not a colour.
 */
function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/** Linearise a single 0–1 sRGB channel (undo gamma). */
function linearise(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black … 1 = white), or null for a bad hex. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => linearise(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio in 1…21, or null if either hex is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ink the product paints on `fillHex`. The luminance here is the
 * stylesheets' own: every channel through the sRGB curve's power segment,
 * without WCAG's linear knee, which relative colour cannot branch on. The two
 * differ only for channels under about 4%, and move the decision by under
 * 0.001. White for an unparseable hex: a default, not a model of the page. A
 * malformed `--brand-color` does not fall back to the platform primary (a
 * `var()` fallback applies only when the property is unset), so the fill and
 * its ink are invalid where they are used and paint no defined ink.
 * `contrastRatio` gives no ratio for it, so nothing reports it as read.
 */
export function inkOn(fillHex: string): string {
  const rgb = parseHex(fillHex);
  if (!rgb) return WHITE;
  const [r, g, b] = rgb.map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < TEXT_ON_BRAND_LUMINANCE_PIVOT ? WHITE : BLACK;
}
