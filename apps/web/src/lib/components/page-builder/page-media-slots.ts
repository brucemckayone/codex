/**
 * The library slots the Media panel (`PageMediaPanel`) offers, and the one it
 * retires.
 *
 * In the order they appear down the sales page, so the panel reads as a walk
 * through the page rather than an arbitrary list. Hero first, because it is the
 * first thing a visitor sees.
 *
 * Kept in step with `JourneySellMediaSlot`: every slot the store knows is
 * offered here or retired, never neither (a slot the store knows and this panel
 * does not is only reachable from a section inspector, the two-sources-of-truth
 * problem the store exists to prevent) and never both.
 */

import type { CourseMediaSlot } from '@codex/access';
import type { JourneySellMediaSlot } from '$lib/page-builder/sell-media-store.svelte';
import * as m from '$paraglide/messages';

export interface PageMediaSlot {
  slot: JourneySellMediaSlot;
  /** Lazy so the label resolves through Paraglide at render, not at module load. */
  label: () => string;
  hint: () => string;
}

export const PAGE_MEDIA_SLOTS: readonly PageMediaSlot[] = [
  {
    slot: 'heroMediaId',
    label: () => m.studio_builder_media_slot_hero(),
    hint: () => m.studio_builder_media_slot_hero_hint(),
  },
  {
    slot: 'introVideoMediaId',
    label: () => m.studio_builder_media_slot_intro(),
    hint: () => m.studio_builder_media_slot_intro_hint(),
  },
  {
    slot: 'previewVideoMediaId',
    label: () => m.studio_builder_media_slot_reel(),
    hint: () => m.studio_builder_media_slot_reel_hint(),
  },
  {
    slot: 'guidePortraitMediaId',
    label: () => m.studio_builder_media_slot_guide_portrait(),
    hint: () => m.studio_builder_media_slot_guide_portrait_hint(),
  },
  {
    slot: 'guideVideoMediaId',
    label: () => m.studio_builder_media_slot_guide_video(),
    hint: () => m.studio_builder_media_slot_guide_video_hint(),
  },
];

/**
 * Slots no surface offers. The store still loads and saves them, so what a
 * creator picked is kept, but nothing on the page reads them.
 *
 * `signatureMediaId` (the "Signature film", Codex-61zsk.47): `media_items` holds
 * video and audio, so it could only give a frame of a film, and the sign-off
 * drew that photo where a mark belongs. The uploaded signature image is the
 * signature's only source.
 */
export const RETIRED_MEDIA_SLOTS: readonly JourneySellMediaSlot[] = [
  'signatureMediaId',
];

/**
 * The store slot behind each course slot the server names when it refuses to
 * publish a page on deleted media (`CourseMediaDeletedError.slots`,
 * Codex-6sbn1). A `Record`, so a slot the server adds fails the typecheck here.
 */
const BY_COURSE_SLOT: Record<CourseMediaSlot, JourneySellMediaSlot> = {
  intro: 'introVideoMediaId',
  reel: 'previewVideoMediaId',
  guide_video: 'guideVideoMediaId',
  hero: 'heroMediaId',
  guide_portrait: 'guidePortraitMediaId',
};

/**
 * The panel's slots among the course slots a refusal names, in panel order.
 * A name this build does not know matches no panel slot, so it drops out: the
 * refusal's message still says what to do.
 */
export function panelSlotsNamed(names: readonly string[]): PageMediaSlot[] {
  const named = new Set<unknown>(
    names.map((name) => BY_COURSE_SLOT[name as CourseMediaSlot])
  );
  return PAGE_MEDIA_SLOTS.filter((entry) => named.has(entry.slot));
}
