import { z } from 'zod';
import { urlSchema } from '../primitives';

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

/** A page's dials and the two steps of each (03 X61); unset is the Style's. */
export const PAGE_DIALS = {
  colour: ['muted', 'vivid'],
  corners: ['brand', 'rounder'],
  spacing: ['compact', 'spacious'],
  drama: ['calmer', 'louder'],
  motion: ['still', 'gentle'],
} as const satisfies Record<string, readonly [string, string]>;

/**
 * Every section type and its hand-designed layouts. The FIRST layout of each
 * type is its fallback when neither the section nor the Style names one.
 * Twin of `ids.ts` `SECTION_LAYOUTS` — `ids.parity.test.ts` asserts equality.
 */
export const SECTION_LAYOUTS = {
  hero: ['statement', 'split', 'cover', 'centered', 'poster'],
  video: ['theatre', 'split'],
  problem: ['statement', 'list', 'split'],
  transformation: ['columns', 'steps', 'statement', 'toggle'],
  benefits: ['grid', 'checklist', 'split', 'bento'],
  curriculum: ['timeline', 'accordion', 'cards', 'map', 'layered'],
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
export const SECTION_TYPE_IDS = Object.keys(SECTION_LAYOUTS) as SectionTypeId[];

/**
 * Where a Button section goes (03 X64). Twin of `ids.ts` `BUTTON_ACTION_IDS`.
 * Validated at the write boundary by {@link buttonActionSchema}.
 */
export const BUTTON_ACTION_IDS = [
  'join',
  'section',
  'preview',
  'link',
] as const;
export type ButtonActionId = (typeof BUTTON_ACTION_IDS)[number];

/** The longest link a Button may hold. */
export const BUTTON_HREF_MAX = 2000;

/**
 * The one rule for a Button's link (03 X64): a full https address with a
 * host and no credentials. Never `http:`, `javascript:`, `data:` or a bare
 * path. The renderer's `isButtonHref` (web, no zod) applies the same rule to
 * what it reads, and a parity test holds the two together.
 */
export function isButtonHref(value: string): boolean {
  if (value.length > BUTTON_HREF_MAX) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * A Button section's action (`props.action`, 03 X64), checked where it is
 * written. A link must pass {@link isButtonHref}; a section target is a
 * section id on the same page (the renderer checks it still exists, and
 * hides the button on the live page when it does not).
 */
export const buttonActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('join') }).strict(),
  z
    .object({ kind: z.literal('section'), target: z.string().min(1).max(100) })
    .strict(),
  z.object({ kind: z.literal('preview') }).strict(),
  z
    .object({
      kind: z.literal('link'),
      // `urlSchema` (http/https, no script or data URLs), narrowed to the
      // Button's own rule.
      href: urlSchema.refine(
        isButtonHref,
        'A button link must be a full web address that starts with https://'
      ),
    })
    .strict(),
]);
export type ButtonActionBody = z.infer<typeof buttonActionSchema>;

// ─── Write-boundary schemas ─────────────────────────────────────────────────

/**
 * A closed enum that DEGRADES instead of rejecting — the same idiom as
 * `journeys.ts`'s (module-private) `designAxis`. Not shared with it by
 * import: that helper is three lines, and re-declaring three lines here is
 * cheaper than a cross-file coupling between two independently-owned schema
 * modules for a helper this small.
 *
 * Used by {@link sectionStyleSchema}'s `scheme`/`spacing` only. The PAGE's
 * `style` (in {@link pageDesignSchema} below) does NOT use this helper — it
 * REJECTS an unrecognised value instead of degrading (owner decision
 * 2026-09-28, Codex-61zsk.29), for the same reason `journeys.ts`'s
 * `designAxis` comment gives: degrading Style would silently turn the whole
 * page's look into Bold, worse than a failed save the creator can retry.
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

/**
 * A PAGE's dials (03 X61), shared by {@link pageDesignSchema} and
 * `journeys.ts`'s `sectionDesignSchema`. Each dial DEGRADES like a section's
 * scheme: a step this build doesn't know reads as the Style's, which is the
 * dial's reset, never a different look; a value that is not an object
 * degrades whole. Unknown dials are stripped.
 */
export const pageDialsSchema = z
  .object({
    colour: closedEnum(PAGE_DIALS.colour),
    corners: closedEnum(PAGE_DIALS.corners),
    spacing: closedEnum(PAGE_DIALS.spacing),
    drama: closedEnum(PAGE_DIALS.drama),
    motion: closedEnum(PAGE_DIALS.motion),
  })
  .optional()
  .catch(undefined);

/**
 * A PAGE's v2 look (`landing_pages.design`, contract §2/§3). See note above.
 *
 * `style` REJECTS an unrecognised value instead of degrading — same
 * exception as `journeys.ts`'s `sectionDesignSchema.style` (owner decision
 * 2026-09-28, Codex-61zsk.29), kept in sync even though this schema isn't
 * wired to a live route yet.
 */
export const pageDesignSchema = z.object({
  style: z
    .enum(PAGE_STYLE_IDS, {
      error: 'Unknown page Style. Refresh and choose a Style again.',
    })
    .optional(),
  dials: pageDialsSchema,
});
export type PageDesignBody = z.infer<typeof pageDesignSchema>;
