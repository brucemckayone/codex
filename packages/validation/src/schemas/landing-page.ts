import { z } from 'zod';

/**
 * The page kit's v2 vocabulary — the zod TWIN of
 * `apps/web/src/lib/page-builder/kit/model/ids.ts`
 * (docs/design/landing-builder/01-contract.md §2, BINDING).
 *
 * `ids.ts` ships in the public bundle and may not import zod (a module-scope
 * zod call there would defeat barrel tree-shaking — see
 * feedback_module_scope_call_defeats_barrel_tree_shaking), so the same closed
 * vocabulary is declared twice: plain arrays for the renderer/editor there,
 * zod schemas for the write boundary here. `ids.parity.test.ts` (web) imports
 * both and fails the moment they drift, so a change to one is a change to
 * both, in the same commit.
 *
 * Contract §2: "Neither may be edited by a WP agent (hand off to the
 * orchestrator)." That rule applies to this file too — it is `ids.ts`'s
 * named twin, not an independent module a later WP may extend on its own.
 */

// ─── Enum twins of ids.ts ──────────────────────────────────────────────────

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

/** A section's colour scheme — each derived from the org brand at render time. */
export const COLOUR_SCHEME_IDS = [
  'base',
  'soft',
  'contrast',
  'brand',
  'accent',
  'atmosphere',
] as const;
export type ColourSchemeId = (typeof COLOUR_SCHEME_IDS)[number];

/** A section's vertical rhythm. */
export const SECTION_SPACING_IDS = ['compact', 'regular', 'spacious'] as const;
export type SectionSpacingId = (typeof SECTION_SPACING_IDS)[number];

/**
 * Every section type and its hand-designed layouts. The FIRST layout of each
 * type is its fallback when neither the section nor the Style names one.
 * Twin of `ids.ts` `SECTION_LAYOUTS` — `ids.parity.test.ts` asserts equality.
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
export const SECTION_TYPE_IDS = Object.keys(SECTION_LAYOUTS) as SectionTypeId[];

// ─── Write-boundary schemas ─────────────────────────────────────────────────

/**
 * A closed enum that DEGRADES instead of rejecting — the same idiom as
 * `journeys.ts`'s (module-private) `designAxis`. Not shared with it by
 * import: that helper is three lines, and re-declaring three lines here is
 * cheaper than a cross-file coupling between two independently-owned schema
 * modules for a helper this small.
 */
const closedEnum = <const T extends readonly [string, ...string[]]>(
  values: T
) => z.enum(values).optional().catch(undefined);

/**
 * A SECTION's v2 style (`landing_pages.sections[].design`, contract §2/§3).
 * `journeys.ts`'s `sectionDesignSchema` is the schema actually wired to the
 * save route — it extends its own object with these same two keys (plus
 * `style`, below) rather than composing this schema in, so the legacy nine
 * axes and the v2 keys live on one shape exactly as `landing_pages.design`
 * already conflates page defaults and section overrides into one column.
 * This schema is the standalone v2-only twin for `ids.parity.test.ts` and for
 * any future v2-native write path.
 */
export const sectionStyleSchema = z.object({
  scheme: closedEnum(COLOUR_SCHEME_IDS),
  spacing: closedEnum(SECTION_SPACING_IDS),
});
export type SectionStyleBody = z.infer<typeof sectionStyleSchema>;

/** A PAGE's v2 look (`landing_pages.design`, contract §2/§3). See note above. */
export const pageDesignSchema = z.object({
  style: closedEnum(PAGE_STYLE_IDS),
});
export type PageDesignBody = z.infer<typeof pageDesignSchema>;
