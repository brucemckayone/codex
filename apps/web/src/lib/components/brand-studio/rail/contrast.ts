/**
 * Control-rail contrast check (Codex-cijzb · WP-1.5).
 *
 * A small, dependency-light WCAG 2.x contrast calculator plus the
 * "text-on-brand" foreground derivation. The rail shows a live readout of the
 * contrast between the brand colour and the text the product auto-places on
 * it, warning the admin when that pair drops below the AA floor.
 *
 * HONESTY NOTE — the foreground derivation mirrors the *real* product rule.
 * `org-brand.css` chooses `--color-text-on-brand` by the brand's relative
 * LUMINANCE, in the `@supports` block at its foot: pure white when it sits
 * below 0.1791, where white and black contrast equally (each 4.58:1), pure
 * black at or above. `deriveTextOnBrand` reproduces that rule, luminance and
 * all, so the readout reflects what visitors actually see — not a guess
 * (Codex-6r63f). Chosen that way, the label clears AA on every sRGB brand:
 * the floor is 4.57:1.
 *
 * An engine without `pow()` inside relative colour (Chrome before 125) keeps
 * the file's older fallback, an OKLCH lightness step at 0.62, which picks the
 * weaker ink for some greens and teals. The readout reports what every current
 * browser paints, not that fallback.
 */

/** WCAG 2.x AA contrast floor for normal-size body text. */
export const AA_CONTRAST_THRESHOLD = 4.5;
/** WCAG 2.x AAA contrast floor for normal-size body text. */
export const AAA_CONTRAST_THRESHOLD = 7;
/**
 * Relative luminance at which the product flips text-on-brand from white to
 * black (see module header / org-brand.css): sqrt(1.05 * 0.05) - 0.05. Kept as
 * a named constant so the rule has one source of truth shared with any test.
 */
export const TEXT_ON_BRAND_LUMINANCE_PIVOT = 0.1791;

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** Parse a #RGB or #RRGGBB hex string to 0–255 channels, or null if malformed. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16);
    const g = Number.parseInt(clean[1] + clean[1], 16);
    const b = Number.parseInt(clean[2] + clean[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

/** Linearise a single 0–1 sRGB channel (undo gamma). */
function linearise(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance of a hex colour (0 = black … 1 = white), or null when
 * the hex is unparseable.
 */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const r = linearise(rgb.r / 255);
  const g = linearise(rgb.g / 255);
  const b = linearise(rgb.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hex colours in the range 1 (identical) …
 * 21 (black-on-white). Returns null if either colour is unparseable.
 */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Luminance as `org-brand.css` computes it to choose the ink: every channel
 * through the sRGB curve's power segment, without WCAG's linear knee, which
 * relative colour cannot branch on. The two differ only for channels under
 * about 4%, and move the decision by under 0.001 (the file explains why the
 * offset must stay).
 */
function inkLuminance({
  r,
  g,
  b,
}: {
  r: number;
  g: number;
  b: number;
}): number {
  const curve = (channel: number) => ((channel / 255 + 0.055) / 1.055) ** 2.4;
  return 0.2126 * curve(r) + 0.7152 * curve(g) + 0.0722 * curve(b);
}

/**
 * The text colour the product auto-places on a given brand colour. Mirrors the
 * `org-brand.css` luminance rule: white below the pivot, black at/above.
 * Falls back to white for an unparseable brand hex (matches the CSS fallback,
 * where a bad `--brand-color` resolves through `--color-primary-500`).
 */
export function deriveTextOnBrand(brandHex: string): string {
  const rgb = parseHex(brandHex);
  if (!rgb) return WHITE;
  return inkLuminance(rgb) < TEXT_ON_BRAND_LUMINANCE_PIVOT ? WHITE : BLACK;
}

export interface BrandContrastResult {
  /** The brand colour under test (echoed back, normalised-free). */
  readonly brand: string;
  /** The derived text-on-brand foreground (`#FFFFFF` or `#000000`). */
  readonly text: string;
  /** WCAG contrast ratio, or null when the brand hex could not be parsed. */
  readonly ratio: number | null;
  /** True when `ratio >= AA` (normal text). False when null. */
  readonly passesAA: boolean;
  /** True when `ratio >= AAA` (normal text). False when null. */
  readonly passesAAA: boolean;
}

/**
 * Evaluate the brand colour against the text the product places on it. This is
 * the single call the rail's readout consumes: pass the current editing-theme
 * brand colour, render `ratio` + the AA/AAA verdicts.
 */
export function evaluateBrandContrast(brandHex: string): BrandContrastResult {
  const text = deriveTextOnBrand(brandHex);
  const ratio = contrastRatio(brandHex, text);
  return {
    brand: brandHex,
    text,
    ratio,
    passesAA: ratio !== null && ratio >= AA_CONTRAST_THRESHOLD,
    passesAAA: ratio !== null && ratio >= AAA_CONTRAST_THRESHOLD,
  };
}

/** Format a ratio for display, e.g. `4.53` → `"4.53:1"`. */
export function formatContrastRatio(ratio: number | null): string {
  if (ratio === null) return '—';
  return `${ratio.toFixed(2)}:1`;
}
