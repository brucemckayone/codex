/**
 * Whether the ink the Showreel draws its words in can keep its floor over the
 * footage: the editor's warning, judged as the reel judges
 * a word. Every reel word is the reel's `--_ink` or `--_ink-soft`, never a
 * brand colour, and which ink that is turns on the theme's ground: the
 * reel's own switch, `groundPoles` (reel-scrim.ts; Showreel.svelte's
 * `--_light`), from `--_gy`, light AT the 0.1791 pivot and above, as the page's
 * `bindingLuminance` holds a light page whose darkest surface is mid grey:
 *
 * - On a LIGHT ground the ink is the page's derived `--color-text-primary`,
 *   which keeps its floor on that ground by construction, so a light ground
 *   never warns.
 * - On a DARK ground it is the player text, `--color-player-text`: the
 *   creator's `player-text` (in the dark theme its dark value, else the light
 *   one), else white, which keeps 4.5:1 on any ground under the pivot. So only
 *   a player text the creator set can warn. The reel words it at the brand's
 *   ground under every frame, so the best it can do is its ratio on that
 *   ground; below the floor no shade carries it.
 *
 * Both themes are judged, each on its own ground: the org's (its dark one in
 * the dark theme, else its light one), else the platform's when the org
 * paints none, exactly as the page paints it (`groundLuminanceVars` gives the
 * same switch the reel reads). A colour that is not a #RGB / #RRGGBB hex is not
 * judged (`paintableColour`), as the ground nudge does not read it either.
 *
 * The ratio is the reel's own (`contrast` in reel-scrim.ts), never a copy, so
 * the editor and the reel agree on every colour.
 */
import {
  contrast,
  groundPoles,
  type Rgb,
} from '$lib/org-hero/showreel/reel-scrim';
import {
  groundLuminanceVars,
  PLATFORM_GROUND_LUMINANCE,
  paintableColour,
} from './ground';
import { hexToSrgb } from './oklch-math';

/** The floor of the reel's body-size words (its `ratioOf`: 4.5, large 3). */
export const REEL_BODY_FLOOR = 4.5;

type Theme = 'light' | 'dark';

/**
 * The platform's own page ground in each theme, painted when the org paints
 * none: `--color-background` is `--color-neutral-50` (light.css) and
 * `--color-neutral-900` (dark.css), from colors.css. A pin test reads them.
 */
export const PLATFORM_PAGE_GROUND: Readonly<Record<Theme, string>> = {
  light: '#fafafa',
  dark: '#171717',
};

type Overrides = Readonly<Record<string, string | null>> | null | undefined;

/** The brand as the editor holds it: its grounds and its token overrides. */
export interface ReelInkBrand {
  readonly background?: string | null;
  readonly backgroundDark?: string | null;
  readonly tokenOverrides?: Overrides;
  readonly darkTokenOverrides?: Overrides;
}

export interface ReelInkWarning {
  /** The theme whose ground the ink falls short on. */
  readonly theme: Theme;
  /**
   * The ink's ratio on that ground, to two places as the reel's notes give it
   * (#CB213C on #0F0000: 3.75), but never rounded up to the floor it misses.
   */
  readonly ratio: number;
  readonly floor: number;
}

const THEMES: readonly Theme[] = ['light', 'dark'];

const rgbOf = (hex: string | undefined): Rgb | null => {
  const srgb = hex ? hexToSrgb(hex) : null;
  return srgb ? [srgb.r, srgb.g, srgb.b] : null;
};

/** Each theme's ground as the page paints it. */
function grounds(brand: ReelInkBrand): Record<Theme, string> {
  // The org's ground is painted only from its light background
  // (`data-org-bg`); its dark one then overrides it in the dark theme.
  const light = paintableColour(brand.background);
  if (!light) return { ...PLATFORM_PAGE_GROUND };
  return { light, dark: paintableColour(brand.backgroundDark) ?? light };
}

/** Each theme's ground luminance as the reel reads it (`--_gy`). */
function groundY(brand: ReelInkBrand): Record<Theme, number> {
  const vars = groundLuminanceVars({
    background: paintableColour(brand.background),
    backgroundDark: paintableColour(brand.backgroundDark),
  });
  return {
    light: Number(vars['--brand-ground-y'] ?? PLATFORM_GROUND_LUMINANCE.light),
    dark: Number(
      vars['--brand-ground-dark-y'] ?? PLATFORM_GROUND_LUMINANCE.dark
    ),
  };
}

/** The player text the creator set for a theme, as the stylesheet falls back. */
function playerText(brand: ReelInkBrand, theme: Theme): string | undefined {
  const dark =
    theme === 'dark' ? brand.darkTokenOverrides?.['player-text'] : undefined;
  return paintableColour(dark ?? brand.tokenOverrides?.['player-text']);
}

/** Two places, but never rounded up to the floor a ratio misses. */
function shown(ratio: number): number {
  const rounded = Math.round(ratio * 100) / 100;
  return rounded < REEL_BODY_FLOOR ? rounded : Math.floor(ratio * 100) / 100;
}

/**
 * Whether the reel reads this ground luminance as light: its ink pole is
 * black (`groundPoles`), so the editor and the reel never disagree at the
 * pivot.
 */
const readsLight = (groundY: number): boolean =>
  groundPoles(groundY).ink.every((channel) => channel === 0);

/**
 * A warning for each theme whose reel ink cannot keep its floor on its
 * ground, light first; none when every theme's can.
 */
export function reelInkWarnings(brand: ReelInkBrand): ReelInkWarning[] {
  const ground = grounds(brand);
  const y = groundY(brand);
  const warnings: ReelInkWarning[] = [];
  for (const theme of THEMES) {
    // A light ground's ink is the derived text colour: it always passes.
    if (readsLight(y[theme])) continue;
    const ink = rgbOf(playerText(brand, theme));
    const under = rgbOf(ground[theme]);
    if (!ink || !under) continue;
    const ratio = contrast(ink, under);
    if (ratio < REEL_BODY_FLOOR) {
      warnings.push({ theme, ratio: shown(ratio), floor: REEL_BODY_FLOOR });
    }
  }
  return warnings;
}
