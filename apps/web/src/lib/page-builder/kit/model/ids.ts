/**
 * The page kit's closed vocabularies — the ids a saved page may carry.
 *
 * This file is the CONTRACT (docs/design/landing-builder/01-contract.md §2).
 * Every list here has a twin in `@codex/validation` (`schemas/landing-page.ts`)
 * that validates writes; `ids.parity.test.ts` fails if the two drift. The twin
 * exists because this module ships in the public bundle and must not pull zod
 * into it (see feedback: a module-scope call defeats barrel tree-shaking).
 *
 * Nothing here is copy. Labels, hints and descriptions live in each block's
 * `definition.ts` and in `styles.ts`.
 */

/** A page's Style — one complete, brand-driven design system. */
export const PAGE_STYLE_IDS = [
  'bold',
  'clean',
  'soft',
  'cinematic',
  'path',
  'poster',
  'studio',
  'quiet',
] as const;
export type PageStyleId = (typeof PAGE_STYLE_IDS)[number];
/** The Style a page renders in when it has none (owner decision 2026-09-26). */
export const DEFAULT_PAGE_STYLE: PageStyleId = 'bold';

/** A section's colour scheme — each derived from the org brand at render time. */
export const COLOUR_SCHEME_IDS = [
  'base',
  'soft',
  'contrast',
  'brand',
  'accent',
  // The org's own shader seen through the section (03-expressive-contract §5.1).
  'atmosphere',
] as const;
export type ColourSchemeId = (typeof COLOUR_SCHEME_IDS)[number];

/** A section's vertical rhythm. */
export const SECTION_SPACING_IDS = ['compact', 'regular', 'spacious'] as const;
export type SectionSpacingId = (typeof SECTION_SPACING_IDS)[number];
export const DEFAULT_SECTION_SPACING: SectionSpacingId = 'regular';

/**
 * A page's dials (03 X61): each moves one thing the Style sets, by one
 * curated step either side of the Style's own. A dial left unset IS the
 * Style's, so its reset deletes the key, and a page with no dials renders
 * exactly as its Style.
 *
 *   colour   muted: the Style's coloured bands take the org's soft tint
 *            vivid: the Style's soft tints take the brand colour
 *   corners  brand: the org's own corners, unbent by the Style
 *            rounder: Soft's corners, on any Style
 *   spacing  the rhythm a section takes when it picks none of its own
 *   drama    calmer: every headline a step smaller
 *            louder: section headings a step larger (the opening and the
 *            closing ask are drawn as large as they fit already)
 *   motion   still: nothing moves; gentle: entrances play, nothing follows
 *            the scroll (the Style's own is all of it)
 */
export const PAGE_DIALS = {
  colour: ['muted', 'vivid'],
  corners: ['brand', 'rounder'],
  spacing: ['compact', 'spacious'],
  drama: ['calmer', 'louder'],
  motion: ['still', 'gentle'],
} as const satisfies Record<string, readonly [string, string]>;
export type PageDialId = keyof typeof PAGE_DIALS;
export type PageDialStep<D extends PageDialId> = (typeof PAGE_DIALS)[D][number];
export type PageDials = { [D in PageDialId]?: PageDialStep<D> };
export const PAGE_DIAL_IDS = Object.keys(PAGE_DIALS) as PageDialId[];

/**
 * Every section type and its hand-designed layouts. The FIRST layout of each
 * type is its fallback when neither the section nor the Style names one.
 */
export const SECTION_LAYOUTS = {
  hero: ['statement', 'split', 'cover', 'centered', 'poster'],
  video: ['theatre', 'split'],
  problem: ['statement', 'list', 'split'],
  transformation: ['columns', 'steps', 'statement', 'toggle'],
  benefits: ['grid', 'checklist', 'split', 'bento'],
  curriculum: ['timeline', 'accordion', 'cards', 'map'],
  preview: ['feature', 'split'],
  instructor: ['split', 'quote', 'centered'],
  testimonials: ['grid', 'featured', 'quote', 'marquee', 'wall'],
  faq: ['accordion', 'columns'],
  pricing: ['cards', 'focus', 'band'],
  cta: ['band', 'split', 'compact'],
  stats: ['row', 'grid'],
  text: ['statement', 'columns', 'centered'],
  story: ['scroll', 'chapters', 'strip'],
  gallery: ['mosaic', 'strip', 'grid'],
  // "What's inside": every practice as a card to swipe through (Codex-61zsk.52).
  inside: ['carousel'],
  // The simple one-job sections (Codex-61zsk.53, 03 X64): each joins the
  // neighbour it serves rather than starting a band of its own.
  picture: ['contained', 'full', 'beside'],
  heading: ['start', 'center'],
  break: ['space'],
  button: ['stack', 'row'],
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type SectionTypeId = keyof typeof SECTION_LAYOUTS;

/**
 * Where a Button section goes (03 X64): the closing ask's own path (`join`,
 * the default, priced), a section on the same page, the page's preview film,
 * or an https link. A proven set rather than a free URL, so the price never
 * sits beside a link that leaves the page.
 */
export const BUTTON_ACTION_IDS = [
  'join',
  'section',
  'preview',
  'link',
] as const;
export type ButtonActionId = (typeof BUTTON_ACTION_IDS)[number];
export type LayoutId<T extends SectionTypeId = SectionTypeId> =
  (typeof SECTION_LAYOUTS)[T][number];

export const SECTION_TYPE_IDS = Object.keys(SECTION_LAYOUTS) as SectionTypeId[];

export function isSectionTypeId(value: unknown): value is SectionTypeId {
  return typeof value === 'string' && Object.hasOwn(SECTION_LAYOUTS, value);
}

export function isLayoutOf(
  type: SectionTypeId,
  value: unknown
): value is LayoutId {
  return (
    typeof value === 'string' &&
    (SECTION_LAYOUTS[type] as readonly string[]).includes(value)
  );
}

export function isPageStyleId(value: unknown): value is PageStyleId {
  return (
    typeof value === 'string' &&
    (PAGE_STYLE_IDS as readonly string[]).includes(value)
  );
}

export function isColourSchemeId(value: unknown): value is ColourSchemeId {
  return (
    typeof value === 'string' &&
    (COLOUR_SCHEME_IDS as readonly string[]).includes(value)
  );
}

export function isSectionSpacingId(value: unknown): value is SectionSpacingId {
  return (
    typeof value === 'string' &&
    (SECTION_SPACING_IDS as readonly string[]).includes(value)
  );
}

export function isPageDialStep<D extends PageDialId>(
  dial: D,
  value: unknown
): value is PageDialStep<D> {
  return (
    typeof value === 'string' &&
    (PAGE_DIALS[dial] as readonly string[]).includes(value)
  );
}

/** A stored dials bag, keeping only known dials at known steps; none → undefined. */
export function readPageDials(value: unknown): PageDials | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const dials: Record<string, string> = {};
  for (const dial of PAGE_DIAL_IDS) {
    const step = (value as Record<string, unknown>)[dial];
    if (isPageDialStep(dial, step)) dials[dial] = step;
  }
  return Object.keys(dials).length > 0 ? (dials as PageDials) : undefined;
}
