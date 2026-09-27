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
 * Every section type and its hand-designed layouts. The FIRST layout of each
 * type is its fallback when neither the section nor the Style names one.
 */
export const SECTION_LAYOUTS = {
  hero: ['statement', 'split', 'cover', 'centered'],
  video: ['theatre', 'split'],
  problem: ['statement', 'list', 'split'],
  transformation: ['columns', 'steps', 'statement', 'toggle'],
  benefits: ['grid', 'checklist', 'split'],
  curriculum: ['timeline', 'accordion', 'cards', 'map'],
  preview: ['feature', 'split'],
  instructor: ['split', 'quote', 'centered'],
  testimonials: ['grid', 'featured', 'quote'],
  faq: ['accordion', 'columns'],
  pricing: ['cards', 'focus', 'band'],
  cta: ['band', 'split', 'compact'],
  stats: ['row', 'grid'],
  text: ['statement', 'columns', 'centered'],
  story: ['scroll', 'chapters', 'strip'],
  gallery: ['mosaic', 'strip', 'grid'],
} as const satisfies Record<string, readonly [string, ...string[]]>;

export type SectionTypeId = keyof typeof SECTION_LAYOUTS;
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
