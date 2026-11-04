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
 * it, on the -subtle chips and on the sticky subscribe bar's glass, so the
 * number is the HARDEST of those surfaces (owner, 2026-11-03:
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
import { hexToOklch, hexToSrgb, oklchToSrgb, srgbToHex } from './oklch-math';

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

/**
 * The sticky subscribe bar's glass (SubscribeStickyBar and the pricing page's
 * copy): `color-mix(in srgb, var(--color-surface) 94%, transparent)`. It is a
 * surface links sit on like any other (owner, Codex-mik4h: "Brand text, glass
 * at 94%"), counted at its hardest: over black content on a light page, over
 * white on a dark one. A pin test keeps this equal to both stylesheets.
 */
export const STICKY_GLASS_OPACITY = 0.94;

/**
 * The -subtle chips labels sit on (org-brand.css) take the ground's side at a
 * fixed lightness, so their luminance is bounded whatever the brand. The
 * hardest, `--color-brand-primary-subtle`, is at least 0.826 as a light chip
 * (oklch 0.96, c×0.2) and at most 0.0075 as a dark one (0.18, c×0.3), over
 * every 8-bit brand, the only kind a writer paints (`paintableColour`); a test
 * re-derives both from the stylesheet. Counted like any surface, at its
 * bound: the chip's brand is not one of this module's inputs.
 */
export const CHIP_LUMINANCE = { light: 0.826, dark: 0.0075 } as const;

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
 * The sticky glass over the content that moves it furthest toward the link:
 * black under a light page, white under a dark one, composited in sRGB.
 * Within 1/255 of both engines, which composite the round-tripped surface
 * rather than the hex.
 */
export function glassLuminance(ground: string): number | null {
  const rgb = hexToSrgb(ground);
  const page = relativeLuminance(ground);
  if (!rgb || page === null) return null;
  const under = page < TEXT_ON_BRAND_LUMINANCE_PIVOT ? 255 : 0;
  const over = (channel: number) =>
    channel * STICKY_GLASS_OPACITY + under * (1 - STICKY_GLASS_OPACITY);
  return relativeLuminance(srgbToHex(over(rgb.r), over(rgb.g), over(rgb.b)));
}

/**
 * The binding ground for one theme as the stylesheet reads it, a bare
 * number to 4 decimals, or undefined for a background the page would not
 * paint (`paintableColour`): every caller reads the same ground.
 */
export function groundLuminance(
  colour: string | null | undefined,
  theme: Theme
): string | undefined {
  const hex = paintableColour(colour);
  const page = hex ? relativeLuminance(hex) : null;
  const surfaces = hex ? surfaceLuminances(hex, theme) : null;
  const glass = hex ? glassLuminance(hex) : null;
  if (page === null || surfaces === null || glass === null) return undefined;
  // Rounded as written, so the chip takes the side the stylesheet reads.
  const written = Number(page.toFixed(4));
  const chip =
    written < TEXT_ON_BRAND_LUMINANCE_PIVOT
      ? CHIP_LUMINANCE.dark
      : CHIP_LUMINANCE.light;
  return bindingLuminance(written, [...surfaces, glass, chip]).toFixed(4);
}

/**
 * A background or brand colour the page may paint: one this module can
 * measure and bound, as the `#RGB` / `#RRGGBB` both CSS and the nudge read,
 * trimmed. Any other form the API may have stored (rgb(), a colour name,
 * var(…), a wide-gamut colour, a bare or 8-digit hex, or not a string at all,
 * since the dark overrides are free JSON) is ignored, so every writer paints
 * the fallback in its place: the platform's background, the light brand for a
 * dark one, the org's for a page's. The nudge then never reads a ground it
 * cannot see, nor sits links on a stylesheet chip CHIP_LUMINANCE does not
 * bound (owner, Codex-mik4h: "Ignore it, like On Brand", and for brand
 * colours, "Same rule as backgrounds"). Writers paint the value this returns;
 * the stored value is untouched.
 */
export function paintableColour(colour: unknown): string | undefined {
  if (typeof colour !== 'string') return undefined;
  const hex = colour.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : undefined;
}

/**
 * The `--brand-ground-y` / `--brand-ground-dark-y` inputs for an org's
 * backgrounds. Empty when the org paints no ground of its own, or its
 * background is not a hex colour (the page then paints the platform's). An
 * unpaintable dark background falls back to the light one, as the stylesheet
 * does once the writers drop it (`paintableColour`).
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
