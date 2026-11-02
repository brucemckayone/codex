/**
 * Control-rail contrast check (Codex-cijzb · WP-1.5).
 *
 * The rail's live readout of the contrast between the brand colour and the
 * text the product places on it. The rule and the maths live in
 * `$lib/brand-editor/ink.ts`, whose contrast maths the presets share, so the
 * readout reports the ink the page actually paints (Codex-6r63f). That rule
 * clears AA on every sRGB brand (floor 4.57:1), so the warn state now shows
 * only for a colour that cannot be read; what else it should warn about is
 * Codex-mik4h.
 */
import { contrastRatio, inkOn } from '$lib/brand-editor/ink';

export {
  contrastRatio,
  inkOn as deriveTextOnBrand,
  relativeLuminance,
  TEXT_ON_BRAND_LUMINANCE_PIVOT,
} from '$lib/brand-editor/ink';

/** WCAG 2.x AA contrast floor for normal-size body text. */
export const AA_CONTRAST_THRESHOLD = 4.5;
/** WCAG 2.x AAA contrast floor for normal-size body text. */
export const AAA_CONTRAST_THRESHOLD = 7;

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
  const text = inkOn(brandHex);
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
