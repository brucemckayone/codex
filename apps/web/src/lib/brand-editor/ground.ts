/**
 * The luminance of the page an org's links sit on (Codex-mik4h).
 *
 * `org-brand.css` nudges the link colour, the focus outline and the focus
 * halo only as far as each needs to read on the page. That needs the brand
 * colour AND the ground, and CSS cannot read two colours' channels in one
 * expression, so every writer of the `--brand-*` inputs also writes the
 * ground's relative luminance as a plain number, one per theme. The
 * stylesheet does the nudge; this module only measures.
 *
 * Written only when the org paints its own ground: `data-org-bg` is set from
 * the LIGHT background alone (Codex-ysyvm), and its dark ground is
 * `--brand-bg-dark`, else `--brand-bg`. Otherwise the page is the platform's
 * and the stylesheet falls back to `PLATFORM_GROUND_LUMINANCE`. A leaf: the
 * SSR layouts, the editor's injection and the page kit's renderer all call
 * it, and the pill reads the same numbers.
 */
import { relativeLuminance } from './ink';

/**
 * The platform ground that binds a link in each theme, page or surface,
 * whichever is closer to the link's side. Light: the `#fafafa` page (the
 * surface is white). Dark: the `#262626` surface (the page is `#171717`).
 * The dark card (`#404040`) is not a ground links must hold on: the
 * platform's own dark link fails it (3.96:1). org-brand.css writes these as
 * its fallbacks; its pin test keeps the two equal.
 */
export const PLATFORM_GROUND_LUMINANCE = {
  light: 0.956,
  dark: 0.0194,
} as const;

/** The inputs this module writes, light then dark. */
export const GROUND_VAR_PROPS = [
  '--brand-ground-y',
  '--brand-ground-dark-y',
] as const;

export interface GroundColours {
  background?: string | null;
  backgroundDark?: string | null;
}

/**
 * One ground's luminance as the stylesheet reads it, a bare number to 4
 * decimals, or undefined for a colour that is not hex.
 */
export function groundLuminance(
  colour: string | null | undefined
): string | undefined {
  const y = colour ? relativeLuminance(colour) : null;
  return y === null ? undefined : y.toFixed(4);
}

/**
 * The `--brand-ground-y` / `--brand-ground-dark-y` inputs for an org's
 * backgrounds. Empty when the org paints no ground of its own, or its
 * background is not a hex colour (the page then paints the platform's).
 */
export function groundLuminanceVars({
  background,
  backgroundDark,
}: GroundColours): Record<string, string> {
  const light = groundLuminance(background);
  if (light === undefined) return {};
  return {
    '--brand-ground-y': light,
    '--brand-ground-dark-y': groundLuminance(backgroundDark) ?? light,
  };
}
