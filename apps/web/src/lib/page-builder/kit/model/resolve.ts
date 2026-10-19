/**
 * Section resolution (contract §3): every choice a creator left unset is read
 * from the page's Style, so changing the Style re-composes the whole page while
 * anything the creator picked stays put.
 *
 *   layout  = section.variant (if valid for the type) → Style default → first layout
 *   scheme  = section.design.scheme → the org's shader (hero) → Style
 *             default, moved by the page's colour dial → 'base'
 *   spacing = section.design.spacing → a compact layout's own → the page's
 *             spacing dial → 'regular'
 *   style   = page.design.style → 'bold'
 *
 * A dial moves only what the Style would have chosen (03 X61): a creator's
 * own choice in a section still wins over the page's dial.
 */

import { isImageRef } from '../../page-images';
import { readButtonAction } from './button-action';
import {
  type ColourSchemeId,
  DEFAULT_PAGE_STYLE,
  DEFAULT_SECTION_SPACING,
  isColourSchemeId,
  isLayoutOf,
  isPageStyleId,
  isSectionSpacingId,
  isSectionTypeId,
  type PageDialStep,
  type PageStyleId,
  SECTION_LAYOUTS,
  type SectionSpacingId,
  type SectionTypeId,
} from './ids';
import { hasHead, readText } from './read';
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
  /** The bands the page's grounds are drawn in (`resolveGroundBands`): a
   * moving background off the bands it is proven on is drawn as `base`
   * (03 X48, X50). Absent: not judged. */
  readonly grounds?: { light?: GroundBandId; dark?: GroundBandId };
}

/** The sections an org's moving background takes by default (owner, D4: "On
 * by default (Recommended)", 03 X50): the page's opening only (D16: "Opening
 * only (Recommended)", 03 X51). The closing ask keeps its Style's own band in
 * the org's colour. Only the Style's default moves; a scheme the page set
 * stays, so a closing ask can still take it. */
const SHADER_SECTIONS: ReadonlySet<SectionTypeId> = new Set(['hero']);

/**
 * One section's scheme on its own. `colour` is the page's colour dial, applied
 * as if no band stood beside it: `resolveSections`, which sees the whole page,
 * lets a vivid band yield to its neighbours.
 */
export function resolveScheme(
  type: SectionTypeId,
  design: SectionStyle | null | undefined,
  style: PageStyleId,
  options: ResolveOptions = {},
  colour?: PageDialStep<'colour'>
): ColourSchemeId {
  const scheme = isColourSchemeId(design?.scheme)
    ? design.scheme
    : options.orgShader && SHADER_SECTIONS.has(type)
      ? 'atmosphere'
      : dialColour(STYLES[style].schemes[type] ?? 'base', colour);
  return scheme === 'atmosphere' &&
    options.grounds &&
    !atmosphereProven(options.grounds)
    ? 'base'
    : scheme;
}

/**
 * The colour dial on a Style's default (03 X61), one rung of ground → soft
 * tint → brand colour: muted brings every coloured band down to the soft
 * tint, vivid takes every soft tint up to the brand colour. The ground stays
 * the ground, so the page keeps its reading surface, and Quiet, which draws
 * no bands, is the same at every step.
 */
function dialColour(
  scheme: ColourSchemeId,
  colour: PageDialStep<'colour'> | undefined
): ColourSchemeId {
  if (colour === 'muted')
    return scheme === 'contrast' || scheme === 'brand' || scheme === 'accent'
      ? 'soft'
      : scheme;
  if (colour === 'vivid') return scheme === 'soft' ? 'brand' : scheme;
  return scheme;
}

/**
 * The colour dial on one section, in its place on the page. Vivid's brand
 * colour yields to a band beside it: beside another brand band the two read
 * as one slab, and beside a contrast band they smear when the brand is dark,
 * so `keepBandsApart` would step one of them back, and it steps back the
 * later one, which is often the Style's own closing ask. `styled` holds each
 * section's scheme before the dial; a scheme the creator chose never moves.
 */
function dialBand(
  styled: readonly ColourSchemeId[],
  index: number,
  colour: PageDialStep<'colour'> | undefined,
  banded: readonly boolean[]
): ColourSchemeId {
  const dialled = dialColour(styled[index], colour);
  if (colour !== 'vivid' || dialled === styled[index]) return dialled;
  // Beside means the nearest band: a simple section between two bands takes
  // one of theirs (03 X64), so a Picture under a brand hero does not hide the
  // hero from the band below it. (`lastIndexOf` reads a negative start from
  // the end, so the first section looks before itself only by this guard.)
  const before = index > 0 ? banded.lastIndexOf(true, index - 1) : -1;
  const after = banded.indexOf(true, index + 1);
  const beside = [
    before >= 0 ? styled[before] : undefined,
    after >= 0 ? styled[after] : undefined,
  ];
  return beside.some((scheme) => scheme === 'brand' || scheme === 'contrast')
    ? styled[index]
    : dialled;
}

/** A chosen spacing wins; otherwise a `compact` layout sits in compact bands,
 *  and every other section in the page's spacing dial (03 X61). */
export function resolveSpacing(
  design: SectionStyle | null | undefined,
  layout?: string,
  dial?: PageDialStep<'spacing'>
): SectionSpacingId {
  if (isSectionSpacingId(design?.spacing)) return design.spacing;
  if (layout === 'compact') return 'compact';
  return dial ?? DEFAULT_SECTION_SPACING;
}

/**
 * Which of `resolveSpacing`'s sources gave a section its spacing: its own,
 * its compact layout, the page's spacing dial, or the kit's default. The
 * inspector says so beside the control (Codex-61zsk.59), in the same order.
 */
export function spacingSource(
  design: SectionStyle | null | undefined,
  layout?: string,
  dial?: PageDialStep<'spacing'>
): 'section' | 'layout' | 'page' | 'default' {
  if (isSectionSpacingId(design?.spacing)) return 'section';
  if (layout === 'compact') return 'layout';
  return dial ? 'page' : 'default';
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
  const dials = page.design?.dials;
  const rendered = renderableSections(page);
  const styled = rendered.map((section) =>
    resolveScheme(section.type, section.design, style, options)
  );
  const banded = rendered.map((section) => !SIMPLE_SECTIONS.has(section.type));
  const seen = new Map<SectionTypeId, number>();
  let heroTaken = false;
  let previousScheme: ColourSchemeId | null = null;

  const resolved = rendered.map((section, index) => {
    const count = (seen.get(section.type) ?? 0) + 1;
    seen.set(section.type, count);
    const isPageHeading = section.type === 'hero' && !heroTaken;
    if (isPageHeading) heroTaken = true;

    const layout = resolveLayout(section.type, section.variant, style);
    // A simple section is transparent to the bands (03 X64): it never
    // advances `previousScheme`, so dropping a Picture between a brand hero
    // and a contrast problem cannot stop the problem stepping back. It takes
    // no dial either: it joins a neighbour's band, already dialled.
    const simple = SIMPLE_SECTIONS.has(section.type);
    const chosen = isColourSchemeId(section.design?.scheme);
    const scheme = simple
      ? styled[index]
      : keepBandsApart(
          chosen
            ? styled[index]
            : dialBand(styled, index, dials?.colour, banded),
          previousScheme,
          chosen
        );
    if (!simple) previousScheme = scheme;
    return {
      id: section.id,
      anchor: count === 1 ? section.type : `${section.type}-${count}`,
      type: section.type,
      index,
      layout,
      scheme,
      spacing: resolveSpacing(section.design, layout, dials?.spacing),
      headingLevel: isPageHeading ? 1 : 2,
    } satisfies ResolvedSection;
  });
  return joinSimpleSections(resolved, page);
}

// ── The simple sections (03 X64, Codex-61zsk.53) ────────────────────────────

/**
 * The one-job sections: a Picture, a Heading, a Break and a Button. None
 * starts a band of its own. Each joins the neighbour it serves: the first
 * three finish the band above, a Heading announces the band below.
 */
export const SIMPLE_SECTIONS: ReadonlySet<SectionTypeId> =
  new Set<SectionTypeId>(['picture', 'heading', 'break', 'button']);

/** The props each section carries, for the rules that read them. */
function propsOf(page: KitPage): (id: string) => Record<string, unknown> {
  const props = new Map(page.sections.map((s) => [s.id, s.props ?? {}]));
  return (id) => props.get(id) ?? {};
}

/**
 * Whether a section stands on a picture of its own (`props.background`,
 * counted when set at all). A simple section never draws one
 * (`SectionShell`), so a stray value there counts for nothing.
 */
function onMediaOf(page: KitPage): (section: ResolvedSection) => boolean {
  const props = propsOf(page);
  return (section) =>
    !SIMPLE_SECTIONS.has(section.type) && props(section.id).background != null;
}

/**
 * A full-width Picture with no caption runs to its band's foot (`kit.css`),
 * so the section under it never gives up its top padding: nothing may sit
 * flush against a picture's bleed edge.
 */
function bleedsToFoot(
  page: KitPage
): (section: ResolvedSection | undefined) => boolean {
  const props = propsOf(page);
  return (section) =>
    section?.type === 'picture' &&
    section.layout === 'full' &&
    readText(props(section.id), 'caption') === undefined;
}

/**
 * Each run of simple sections takes the ground of the ordinary sections
 * around it (03 X64):
 *
 *   - everything before the run's first Heading joins A, the section above;
 *   - everything from that Heading on joins B, the section below, because a
 *     heading announces what follows (Heading, Picture, Stages: the Picture
 *     belongs to the stages' part);
 *   - with no B (the page's end), the Heading's part falls back to A.
 *
 * X58's guards hold: nothing joins a section with its own backdrop (the
 * hero, the closing ask), one on a picture, or one on the shader. An
 * up-joiner that cannot join A stands on its own (its Style default, padded
 * both sides), except a Break, which then takes B's ground: a Break never
 * has a ground of its own, so it can never be an empty band. A Heading that
 * can join neither stands on its own.
 *
 * A colour the creator chose wins: that section is not joined, keeps its
 * padding on both sides, and nothing joins it. A Break has no colour control,
 * so a stored scheme on one is ignored.
 */
export function joinSimpleSections(
  sections: readonly ResolvedSection[],
  page: KitPage
): ResolvedSection[] {
  const designs = new Map(page.sections.map((s) => [s.id, s.design]));
  const onMedia = onMediaOf(page);
  const chosen = (section: ResolvedSection) =>
    section.type !== 'break' &&
    isColourSchemeId(designs.get(section.id)?.scheme);
  const joinable = (section: ResolvedSection | undefined) =>
    section !== undefined &&
    !SIMPLE_SECTIONS.has(section.type) &&
    section.scheme !== 'atmosphere' &&
    !OWN_BACKDROP.has(section.type) &&
    !onMedia(section);
  const free = (section: ResolvedSection | undefined) =>
    section !== undefined &&
    SIMPLE_SECTIONS.has(section.type) &&
    !chosen(section);

  const out = sections.map((section) => ({ ...section }));
  const take = (
    section: ResolvedSection,
    from: ResolvedSection,
    join: 'above' | 'below'
  ) => {
    section.scheme = from.scheme;
    section.join = join;
  };

  for (let start = 0; start < out.length; start++) {
    if (!free(out[start])) continue;
    let end = start;
    while (free(out[end + 1])) end++;
    const run = out.slice(start, end + 1);
    const above = out[start - 1];
    const below = out[end + 1];
    const a = joinable(above) ? above : undefined;
    const b = joinable(below) ? below : undefined;

    const heading = run.findIndex((section) => section.type === 'heading');
    const up = heading === -1 ? run : run.slice(0, heading);
    const down = heading === -1 ? [] : run.slice(heading);
    for (const section of up) {
      if (a) take(section, a, 'above');
      else if (section.type === 'break' && b) take(section, b, 'below');
    }
    for (const section of down) {
      if (b) take(section, b, 'below');
      else if (a) take(section, a, 'above');
    }
    start = end;
  }
  return out;
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

/**
 * The blocks whose head is their eyebrow, heading and lead (`hasHead`). With
 * none of the three, such a block has no words of its own: its content (the
 * questions, the list, the pictures) starts at its top.
 */
export const HEADED_BY_WORDS: ReadonlySet<SectionTypeId> =
  new Set<SectionTypeId>([
    'benefits',
    'curriculum',
    'faq',
    'gallery',
    'inside',
    'stats',
    'story',
    'testimonials',
    'transformation',
    'video',
  ]);

/** Types that draw their own backdrop (01 A5), so the shell never adds one. */
export const OWN_BACKDROP: ReadonlySet<SectionTypeId> = new Set<SectionTypeId>([
  'hero',
  'cta',
]);

/**
 * The sections that CONTINUE the band above them (03 X58): no words of their
 * own, on the same plain ground. Two sections on one ground are parted by
 * space alone, each band's padding, and a heading is what makes that space
 * read as a new section. Without one the space reads as a hole: questions
 * set two paddings under the offer they answer for. A continuing section
 * gives up its top padding, so the band above's foot is the whole joint.
 *
 * Never across a change of ground (the bands part it), on or under a picture
 * (`props.background`, counted when set at all, so an unreadable one keeps
 * the section apart), on the shader, or under a type with its own backdrop.
 */
export function continuingSections(
  page: KitPage,
  sections: readonly ResolvedSection[]
): ReadonlySet<string> {
  const props = propsOf(page);
  const onMedia = onMediaOf(page);
  const bleeds = bleedsToFoot(page);
  const continuing = new Set<string>();
  sections.forEach((section, index) => {
    const above = sections[index - 1];
    // Nothing sits flush against a picture's bleed edge (03 X64).
    if (!above || bleeds(above) || section.scheme !== above.scheme) return;
    if (
      // A joined Picture, Break or Button finishes the band above, and
      // everything after a joined Heading belongs to the part it opens. A
      // Heading itself keeps its top: a new part starts there (03 X64).
      (section.join !== undefined && section.type !== 'heading') ||
      // The section a joined Heading announces gives up its top padding,
      // even when it has a head of its own (03 X64).
      // A Break is space in front of that part, so the part keeps its own.
      (!SIMPLE_SECTIONS.has(section.type) &&
        above.join === 'below' &&
        above.type !== 'break') ||
      // No words of its own on the ground above (03 X58).
      (HEADED_BY_WORDS.has(section.type) &&
        !hasHead(props(section.id)) &&
        section.scheme !== 'atmosphere' &&
        !OWN_BACKDROP.has(above.type) &&
        !onMedia(section) &&
        !onMedia(above))
    ) {
      continuing.add(section.id);
    }
  });
  return continuing;
}

/** What a visitor's page knows of its films, for {@link foldForVisitors}. */
export interface FoldOptions {
  /** `false` when the page certainly has no preview film (`filmsAttached.reel`). */
  readonly previewFilm?: boolean;
}

/**
 * The sections a VISITOR's page draws: an empty Picture (no picture) or
 * Heading (no title) is folded here, before the bands are resolved, so the
 * band rules never count a section nobody can see (03 X64). So is a Button
 * whose action has nowhere to go: a section that is gone or hidden, a
 * preview film the page does not have, or a link it cannot trust. Its label
 * was written for that destination, so it is hidden rather than sent to the
 * checkout under the wrong words. The canvas and still thumbnails keep every
 * section: there an empty one draws its prompt, and a dead Button its
 * warning.
 */
export function foldForVisitors(
  page: KitPage,
  options: FoldOptions = {}
): KitPage {
  const shown = page.sections.filter((section) => {
    const props = section.props ?? {};
    if (section.type === 'picture') return isImageRef(props.image);
    if (section.type === 'heading')
      return readText(props, 'heading') !== undefined;
    return true;
  });
  const drawn = new Set(
    shown
      .filter((s) => s.enabled !== false && isSectionTypeId(s.type))
      .map((s) => s.id)
  );
  return {
    ...page,
    sections: shown.filter(
      (section) =>
        section.type !== 'button' ||
        buttonGoes(section.props ?? {}, section.id, drawn, options)
    ),
  };
}

/** Whether a Button's action has somewhere to go on the visitor's page. */
function buttonGoes(
  props: Record<string, unknown>,
  id: string,
  drawn: ReadonlySet<string>,
  options: FoldOptions
): boolean {
  if (props.action === undefined) return true;
  const action = readButtonAction(props.action);
  if (!action) return false;
  if (action.kind === 'section') {
    return action.target !== id && drawn.has(action.target);
  }
  if (action.kind === 'preview') return options.previewFilm !== false;
  return true;
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
