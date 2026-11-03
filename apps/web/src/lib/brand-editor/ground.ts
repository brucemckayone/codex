/**
 * The luminance of the hardest ground an org's links sit on (Codex-mik4h).
 *
 * `org-brand.css` nudges the link colour, the focus outline and the focus
 * halo only as far as each needs to read. That needs the brand colour AND the
 * ground, and CSS cannot read two colours' channels in one expression, so
 * every writer of the `--brand-*` inputs also writes a ground's relative
 * luminance as a plain number, one per theme. The stylesheet does the nudge;
 * this module only measures.
 *
 * One link colour sits on the page and on every panel and card painted from
 * it, so the number is the HARDEST of those surfaces (owner, 2026-11-03:
 * "Every surface (Recommended)", and for dark mode's lighter panel, "Yes,
 * every surface (Recommended)"): the darkest on a light page, where links are
 * darkened, the lightest on a dark one, where they are lightened.
 *
 * Written only when the org paints its own ground: `data-org-bg` is set from
 * the LIGHT background alone (Codex-ysyvm), and its dark ground is
 * `--brand-bg-dark`, else `--brand-bg`. Otherwise the surfaces are the
 * platform's and the stylesheet falls back to `PLATFORM_GROUND_LUMINANCE`. A
 * leaf: the SSR layouts, the editor's injection and the page kit's renderer
 * all call it, and the pill reads the same numbers.
 */
import { relativeLuminance, TEXT_ON_BRAND_LUMINANCE_PIVOT } from './ink';
import { hexToOklch, oklchToSrgb, srgbToHex } from './oklch-math';

type Theme = 'light' | 'dark';

/**
 * The hardest platform surface in each theme. Light: the `#e5e5e5` tertiary
 * panel (the page is `#fafafa`, the card white). Dark: the `#525252` tertiary
 * panel (the page is `#171717`, the card `#404040`). org-brand.css writes
 * these as its fallbacks; the pin tests keep both equal to the themes.
 */
export const PLATFORM_GROUND_LUMINANCE = {
  light: 0.7835,
  dark: 0.0844,
} as const;

/**
 * Each surface org-brand.css's `[data-org-bg]` rules paint from the org's
 * ground, as `oklch(from GROUND calc(l + dl) calc(c * k) h)`: `[dl, k]`. The
 * overlay is a translucent scrim, not a ground, and is left out. A pin test
 * reads the stylesheet, so these cannot drift from it.
 */
export const ORG_SURFACE_STEPS: Record<
  Theme,
  Record<string, readonly [number, number]>
> = {
  light: {
    '--color-background': [0, 1],
    '--color-surface': [0, 1],
    '--color-surface-secondary': [-0.03, 0.5],
    '--color-surface-tertiary': [-0.06, 0.5],
    '--color-surface-elevated': [0.02, 0.3],
    '--color-surface-card': [0.05, 0.2],
    '--color-surface-variant': [-0.04, 0.4],
  },
  dark: {
    '--color-background': [0, 1],
    '--color-surface': [0, 1],
    '--color-surface-secondary': [0.04, 0.5],
    '--color-surface-tertiary': [0.08, 0.5],
    '--color-surface-elevated': [0.06, 0.3],
    '--color-surface-card': [0.07, 0.2],
    '--color-surface-variant': [0.06, 0.4],
  },
};

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
 * The surface that binds, from the page's and its surfaces' luminances: the
 * darkest where the page is light, the lightest where it is dark. Held on
 * the page's side of the pivot, because the stylesheet reads the direction
 * of the nudge from this same number: a light page whose darkest panel is
 * mid grey binds AT the pivot, where black is the best any link can do.
 */
export function bindingLuminance(page: number, surfaces: number[]): number {
  const pivot = TEXT_ON_BRAND_LUMINANCE_PIVOT;
  if (page < pivot) {
    return Math.min(Math.max(page, ...surfaces), pivot - 0.0001);
  }
  return Math.max(Math.min(page, ...surfaces), pivot);
}

/**
 * `oklch(from COLOUR calc(l + dl) calc(c * k) h)` as the engines paint it:
 * its channels clipped to sRGB, then rounded to 8 bits.
 */
export function oklchStep(
  colour: string,
  dl: number,
  k: number
): string | null {
  const oklch = hexToOklch(colour);
  if (!oklch) return null;
  const l = Math.min(1, Math.max(0, oklch.l + dl));
  const { r, g, b } = oklchToSrgb(l, oklch.c * k, oklch.h);
  return srgbToHex(r, g, b);
}

/** The luminance of each surface painted from a ground. */
function surfaceLuminances(ground: string, theme: Theme): number[] | null {
  const luminances = Object.values(ORG_SURFACE_STEPS[theme]).map(([dl, k]) => {
    const hex = oklchStep(ground, dl, k);
    return hex === null ? null : relativeLuminance(hex);
  });
  return luminances.every((y): y is number => y !== null) ? luminances : null;
}

/**
 * The binding ground for one theme as the stylesheet reads it, a bare
 * number to 4 decimals, or undefined for a colour that is not hex.
 */
export function groundLuminance(
  colour: string | null | undefined,
  theme: Theme
): string | undefined {
  const page = colour ? relativeLuminance(colour) : null;
  const surfaces = colour ? surfaceLuminances(colour, theme) : null;
  if (page === null || surfaces === null) return undefined;
  return bindingLuminance(Number(page.toFixed(4)), surfaces).toFixed(4);
}

/**
 * A background the page may paint: one whose ground this module can measure.
 * Any other form (rgb(), a colour name, var(…)) the API may have stored is
 * ignored, so every writer paints the platform's in its place and the nudge
 * never reads a ground it cannot see (owner, Codex-mik4h: "Ignore it, like On
 * Brand"). The stored value is untouched.
 */
export function paintableBackground(
  colour: string | null | undefined
): string | undefined {
  return colour && relativeLuminance(colour) !== null ? colour : undefined;
}

/**
 * The `--brand-ground-y` / `--brand-ground-dark-y` inputs for an org's
 * backgrounds. Empty when the org paints no ground of its own, or its
 * background is not a hex colour (the page then paints the platform's). An
 * unpaintable dark background falls back to the light one, as the stylesheet
 * does once the writers drop it (`paintableBackground`).
 */
export function groundLuminanceVars({
  background,
  backgroundDark,
}: GroundColours): Record<string, string> {
  const light = groundLuminance(background, 'light');
  const dark =
    groundLuminance(backgroundDark, 'dark') ??
    groundLuminance(background, 'dark');
  if (light === undefined || dark === undefined) return {};
  return { '--brand-ground-y': light, '--brand-ground-dark-y': dark };
}
