/**
 * Section resolution (contract §3): every choice a creator left unset is read
 * from the page's Style, so changing the Style re-composes the whole page while
 * anything the creator picked stays put.
 *
 *   layout  = section.variant (if valid for the type) → Style default → first layout
 *   scheme  = section.design.scheme → the org's shader (hero, cta) → Style
 *             default → 'base'
 *   spacing = section.design.spacing → 'regular'
 *   style   = page.design.style → 'bold'
 */
import {
  type ColourSchemeId,
  DEFAULT_PAGE_STYLE,
  DEFAULT_SECTION_SPACING,
  isColourSchemeId,
  isLayoutOf,
  isPageStyleId,
  isSectionSpacingId,
  isSectionTypeId,
  type PageStyleId,
  SECTION_LAYOUTS,
  type SectionSpacingId,
  type SectionTypeId,
} from './ids';
import { STYLES } from './styles';
import type {
  KitPage,
  KitSection,
  PageDesign,
  ResolvedSection,
  SectionStyle,
} from './types';

export function resolveStyle(
  design: PageDesign | null | undefined
): PageStyleId {
  return isPageStyleId(design?.style) ? design.style : DEFAULT_PAGE_STYLE;
}

export function resolveLayout(
  type: SectionTypeId,
  variant: string | null | undefined,
  style: PageStyleId
): string {
  if (isLayoutOf(type, variant)) return variant;
  const styled = STYLES[style].layouts[type];
  return isLayoutOf(type, styled) ? styled : SECTION_LAYOUTS[type][0];
}

/** What the org brings to a page's defaults, as plain data from its caller. */
export interface ResolveOptions {
  /** The org has a moving background: a shader preset other than 'none'. */
  readonly orgShader?: boolean;
}

/** The sections an org's moving background takes by default (owner, D4: "On
 * by default (Recommended)", 03 X50): the page's opening and its closing ask.
 * Only the Style's default moves; a scheme the page set stays. */
const SHADER_SECTIONS: ReadonlySet<SectionTypeId> = new Set(['hero', 'cta']);

export function resolveScheme(
  type: SectionTypeId,
  design: SectionStyle | null | undefined,
  style: PageStyleId,
  options: ResolveOptions = {}
): ColourSchemeId {
  if (isColourSchemeId(design?.scheme)) return design.scheme;
  if (options.orgShader && SHADER_SECTIONS.has(type)) return 'atmosphere';
  return STYLES[style].schemes[type] ?? 'base';
}

/** A chosen spacing wins; otherwise a `compact` layout sits in compact bands. */
export function resolveSpacing(
  design: SectionStyle | null | undefined,
  layout?: string
): SectionSpacingId {
  if (isSectionSpacingId(design?.spacing)) return design.spacing;
  return layout === 'compact' ? 'compact' : DEFAULT_SECTION_SPACING;
}

/** The sections a page actually renders: enabled, and of a known type. */
export function renderableSections(page: KitPage): KitSection[] {
  return page.sections.filter(
    (section) => section.enabled !== false && isSectionTypeId(section.type)
  );
}

/**
 * Resolve every rendered section once. Hidden sections take no index and no
 * anchor, so an anchor never points at nothing and the first VISIBLE hero is
 * the page's one `<h1>` — a duplicate hero is demoted rather than dropped, so
 * its author can still see and delete it.
 */
export function resolveSections(
  page: KitPage,
  options: ResolveOptions = {}
): ResolvedSection[] {
  const style = resolveStyle(page.design);
  const seen = new Map<SectionTypeId, number>();
  let heroTaken = false;
  let previousScheme: ColourSchemeId | null = null;

  return renderableSections(page).map((section, index) => {
    const count = (seen.get(section.type) ?? 0) + 1;
    seen.set(section.type, count);
    const isPageHeading = section.type === 'hero' && !heroTaken;
    if (isPageHeading) heroTaken = true;

    const layout = resolveLayout(section.type, section.variant, style);
    const scheme = keepBandsApart(
      resolveScheme(section.type, section.design, style, options),
      previousScheme,
      isColourSchemeId(section.design?.scheme)
    );
    previousScheme = scheme;
    return {
      id: section.id,
      anchor: count === 1 ? section.type : `${section.type}-${count}`,
      type: section.type,
      index,
      layout,
      scheme,
      spacing: resolveSpacing(section.design, layout),
      headingLevel: isPageHeading ? 1 : 2,
    };
  });
}

/**
 * Two identical COLOURED bands in a row read as one oversized slab (a
 * contrast "problem" straight into a contrast "before and after", or a CTA
 * dropped under a brand hero), and a brand band against a contrast band
 * smears into one block when the brand is very dark — the two are then
 * near-identical. A Style DEFAULT that would do either steps back to `base`.
 * A Style's own `order` is designed apart (catalog.test.ts), but a starter, a
 * creator's reorder or a hidden section between two bands brings them
 * together, and only this sees the page as it renders. A scheme the creator
 * chose is never overridden, and base-after-base is how plain sections are
 * meant to flow.
 */
function keepBandsApart(
  scheme: ColourSchemeId,
  previous: ColourSchemeId | null,
  chosen: boolean
): ColourSchemeId {
  if (chosen || scheme === 'base' || previous === null) return scheme;
  const smears =
    (scheme === 'brand' && previous === 'contrast') ||
    (scheme === 'contrast' && previous === 'brand');
  return scheme === previous || smears ? 'base' : scheme;
}

/** The scheme a featured card renders in, inside a section of `scheme`. */
export function featuredScheme(
  style: PageStyleId,
  scheme: ColourSchemeId
): ColourSchemeId {
  return STYLES[style].featured[scheme];
}

// ── The ground's pole and band (owner, D1 and "Fix it next"; 03 X48) ────────
//
// The kit draws a page on the org's own ground. Which side its inks sit on
// (the POLE) follows that ground, not the viewer's theme: an org that sets a
// dark ground has light ink in both themes, as its own pages do. CSS cannot
// select on a colour's lightness, so the pole and the band are resolved here,
// from the backgrounds, and put on the root (`data-ground-light`,
// `data-ground-dark`) for `styles/schemes.css` to select on.

/** Where black and white ink cross: below this luminance white text holds
 * more contrast than black (each 4.58:1 here). A ground at or under it is the
 * dark pole. The kit's ink fragments switch at the same point (`--_w`). */
export const INK_CROSSOVER = 0.1791;

/**
 * The bands a ground can be drawn in, by OKLCH lightness: a light band is
 * [edge, 1], a dark one [0, edge], and every floor is proven against the
 * worst surface each can hold (`styles/schemes.test.ts`). The first of each
 * pole is the band the kit has always used; the rest let a mid-tone ground be
 * drawn as itself. The last of each is the last step at which decorated text
 * still reaches 4.5:1 with the kit's 2% margin: a light edge of 0.64 cannot,
 * nor can the next dark step, 0.54.
 */
export const GROUND_BANDS = [
  { id: 'l90', pole: 'light', edge: 0.9 },
  { id: 'l85', pole: 'light', edge: 0.85 },
  { id: 'l80', pole: 'light', edge: 0.8 },
  { id: 'l75', pole: 'light', edge: 0.75 },
  { id: 'l70', pole: 'light', edge: 0.7 },
  { id: 'l65', pole: 'light', edge: 0.65 },
  { id: 'd24', pole: 'dark', edge: 0.24 },
  { id: 'd30', pole: 'dark', edge: 0.3 },
  { id: 'd36', pole: 'dark', edge: 0.36 },
  { id: 'd42', pole: 'dark', edge: 0.42 },
  { id: 'd48', pole: 'dark', edge: 0.48 },
] as const;

export type GroundBandId = (typeof GROUND_BANDS)[number]['id'];

/** The bands the moving background (`atmosphere`, 03 §5.1, X50) is drawn
 * on: each band's veil is the thinnest that holds every floor over pure black
 * and pure white (`styles/schemes.test.ts`), and these are the bands where
 * it still lets at least half as much shader through as the pole's first
 * band (l85 0.89, d30 0.92; l80 needs 0.98, the rest are opaque). Elsewhere
 * such a section is drawn as `base`. */
const ATMOSPHERE_BANDS: ReadonlySet<GroundBandId | undefined> = new Set([
  undefined,
  'l90',
  'l85',
  'd24',
  'd30',
]);

/** Whether a page whose grounds are in these bands can draw `atmosphere`. */
export function atmosphereProven(bands: {
  light?: GroundBandId;
  dark?: GroundBandId;
}): boolean {
  return ATMOSPHERE_BANDS.has(bands.light) && ATMOSPHERE_BANDS.has(bands.dark);
}

/** `#rgb` or `#rrggbb` as linear sRGB, or null for anything else. */
function linearRgb(colour: string): [number, number, number] | null {
  const hex = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const channel = (i: number) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4)];
}

/** The band a ground is drawn in: its pole by luminance, then the narrowest
 * band of that pole holding its OKLCH lightness, else the pole's last band
 * (where the ground moves to the edge). Undefined for no ground or one that
 * is not a hex colour: the kit then takes the viewer's theme's pole. */
export function groundBand(
  colour: string | null | undefined
): GroundBandId | undefined {
  const rgb = colour ? linearRgb(colour) : null;
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const l =
    0.2104542553 *
      Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) +
    0.793617785 *
      Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) -
    0.0040720468 *
      Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const pole = y > INK_CROSSOVER ? 'light' : 'dark';
  const bands = GROUND_BANDS.filter((band) => band.pole === pole);
  const holds = bands.find((band) =>
    pole === 'light' ? l >= band.edge : l <= band.edge
  );
  return (holds ?? bands[bands.length - 1])?.id;
}

/** Each theme's background, where one is set. */
export interface ThemeGrounds {
  readonly light?: string | null;
  readonly dark?: string | null;
}

/**
 * The band of the ground each theme draws. The org's dark ground is its dark
 * background, else its light one (as `org-brand.css` paints it). A page's own
 * background applies to its own theme only, and the other theme is the org's
 * (owner, D7). A theme with no background is the platform's: no band.
 */
export function resolveGroundBands(
  org: ThemeGrounds,
  page: ThemeGrounds = {}
): { light?: GroundBandId; dark?: GroundBandId } {
  return {
    light: groundBand(page.light || org.light),
    dark: groundBand(page.dark || org.dark || org.light),
  };
}
