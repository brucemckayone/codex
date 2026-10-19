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
