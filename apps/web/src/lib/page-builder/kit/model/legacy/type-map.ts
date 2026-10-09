import type { SectionTypeId } from '../ids';

/**
 * Legacy section type → v2 section type (contract §2 table, "Replaces
 * legacy" column, inverted). Snapshotted from `CourseSectionType` in
 * `@codex/shared-types` `journeys.ts` — the eleven ids the old catalogue ever
 * declared. A type not in this map is unknown and is DROPPED by `upgrade.ts`
 * (contract §3: "Unknown legacy types are dropped"); `cta`/`stats`/`text` have
 * no legacy source at all ("— (new)" in the contract table) and so never
 * appear as a MAP VALUE here, only ever reached by v2 pass-through.
 */
export const LEGACY_TYPE_MAP: Readonly<Record<string, SectionTypeId>> = {
  hero: 'hero',
  introVideo: 'video',
  ache: 'problem',
  turn: 'transformation',
  feel: 'benefits',
  map: 'curriculum',
  reel: 'preview',
  guide: 'instructor',
  proof: 'testimonials',
  faq: 'faq',
  invite: 'pricing',
};
