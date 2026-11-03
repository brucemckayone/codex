/**
 * What the brand studio's pill lists for the theme being edited (Codex-mik4h;
 * owner: "Adjust it, say so"): each colour the page nudges against its ground,
 * whether it moved, and how far.
 *
 * The page's own nudge is in org-brand.css; `ground-nudge.ts` is its
 * TypeScript twin, so this reports what visitors see. The inputs mirror the
 * stylesheet's: the brand colour the theme paints, the org's backgrounds
 * (the hardest surface painted from them is the ground, else the platform's
 * hardest), and the fine-tune overrides the page reads in both themes
 * (`tokenOverrides`; the dark map has no reader yet, Codex-ompmr).
 */
import {
  groundLuminanceVars,
  oklchStep,
  PLATFORM_GROUND_LUMINANCE,
} from '$lib/brand-editor/ground';
import {
  LINK_FLOOR,
  MARK_FLOOR,
  type Nudge,
  nudgeForGround,
} from '$lib/brand-editor/ground-nudge';

export interface LegibilityInputs {
  theme: 'light' | 'dark';
  /** The brand colour this theme paints. */
  brand: string;
  background?: string | null;
  backgroundDark?: string | null;
  /** Fine-tune overrides: `interactive`, `focus`, `focus-ring`. */
  overrides?: Record<string, string | null | undefined> | null;
}

export interface Legibility {
  link: Nudge | null;
  /**
   * Hovered and pressed links, only when one of them moved: the one that
   * moved further. Each follows its own fill, which an override can set apart
   * from the resting link.
   */
  linkStates: Nudge | null;
  /**
   * Labels in the brand colour, only when an `interactive` or
   * `interactive-hover` override sets the links apart from them: the resting
   * or hovered label, whichever moved further, else the resting one.
   */
  brandText: Nudge | null;
  focus: Nudge | null;
  halo: Nudge | null;
  /** How many of them the page moved. */
  adjusted: number;
}

/** The ground's luminance for a theme, as the writers emit it. */
export function groundFor({
  theme,
  background,
  backgroundDark,
}: LegibilityInputs): number {
  const vars = groundLuminanceVars({ background, backgroundDark });
  const own =
    vars[theme === 'dark' ? '--brand-ground-dark-y' : '--brand-ground-y'];
  return own === undefined ? PLATFORM_GROUND_LUMINANCE[theme] : Number(own);
}

/**
 * The halo's colour before its nudge: org-brand.css's
 * `oklch(from BRAND calc(l ± …) calc(c * 0.5) h)`, lighter in light and darker
 * in dark.
 */
function haloSource(brand: string, theme: 'light' | 'dark'): string | null {
  return oklchStep(brand, theme === 'dark' ? -0.1 : 0.15, 0.5);
}

/**
 * A button's hovered fill: org-brand.css's `oklch(from BRAND calc(l ∓ 0.08) c h)`,
 * darker in light and lighter in dark.
 */
export function hoverFill(
  brand: string,
  theme: 'light' | 'dark'
): string | null {
  return oklchStep(brand, theme === 'dark' ? 0.08 : -0.08, 1);
}

/** A button's pressed fill: `oklch(from BRAND calc(l ∓ 0.15) c h)`. */
function pressedFill(brand: string, theme: 'light' | 'dark'): string | null {
  return oklchStep(brand, theme === 'dark' ? 0.15 : -0.15, 1);
}

/** Of several nudges, the one that moved furthest: the lowest as picked. */
function furthest(nudges: (Nudge | null)[]): Nudge | null {
  let pick: Nudge | null = null;
  for (const nudge of nudges) {
    if (nudge?.moved && (pick === null || nudge.before < pick.before)) {
      pick = nudge;
    }
  }
  return pick;
}

export function legibilityFor(inputs: LegibilityInputs): Legibility {
  const ground = groundFor(inputs);
  const overrides = inputs.overrides ?? {};
  const focusSource = overrides.focus ?? inputs.brand;
  const haloFrom =
    overrides['focus-ring'] ?? haloSource(inputs.brand, inputs.theme);
  const asLink = (hex: string | null | undefined) =>
    hex ? nudgeForGround(hex, ground, LINK_FLOOR) : null;

  // The hover and pressed fills follow the brand colour, not the
  // `interactive` override (org-brand.css), unless overridden themselves.
  const brandHover = hoverFill(inputs.brand, inputs.theme);
  const link = asLink(overrides.interactive ?? inputs.brand);
  const linkStates = furthest([
    asLink(overrides['interactive-hover'] ?? brandHover),
    asLink(
      overrides['interactive-active'] ?? pressedFill(inputs.brand, inputs.theme)
    ),
  ]);
  const setApart = Boolean(
    overrides.interactive || overrides['interactive-hover']
  );
  const brandText = setApart
    ? (furthest([asLink(inputs.brand), asLink(brandHover)]) ??
      asLink(inputs.brand))
    : null;
  const focus = nudgeForGround(focusSource, ground, MARK_FLOOR);
  const halo = haloFrom ? nudgeForGround(haloFrom, ground, MARK_FLOOR) : null;
  const adjusted = [link, linkStates, brandText, focus, halo].filter(
    (n) => n?.moved
  ).length;
  return { link, linkStates, brandText, focus, halo, adjusted };
}

/** A move is "a lot" when the colour as picked was under two thirds of its floor. */
export function movedALot(nudge: Nudge, floor: number): boolean {
  return nudge.before < (floor * 2) / 3;
}
