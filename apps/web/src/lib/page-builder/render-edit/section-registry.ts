/**
 * Section type → renderer component map (Codex-2pryk · WP-3/WP-5).
 *
 * Maps the 11 catalogue {@link CourseSectionType}s onto the 8 shared renderer
 * components (the prototype shares one renderer across several semantic types:
 * `prose` backs ache/turn/feel; `video` backs introVideo/reel). An unknown type
 * resolves to `null` so the renderer SKIPS it — forward-compatible with a widened
 * `PageSection.type` (SPEC §4.1).
 *
 * This module (and everything under `render/`) is the PUBLIC page renderer, not
 * editor UI — so it is safe under `$lib/page-builder`. It is NOT re-exported from
 * the inert `$lib/page-builder` barrel (that stays component-free); import it from
 * `$lib/page-builder/render`.
 */
import type { Component } from 'svelte';
import type { SectionComponentProps } from './section-render';
import FaqSection from './sections/FaqSection.svelte';
import GuideSection from './sections/GuideSection.svelte';
import HeroSection from './sections/HeroSection.svelte';
import InviteSection from './sections/InviteSection.svelte';
import MapSection from './sections/MapSection.svelte';
import ProofSection from './sections/ProofSection.svelte';
import ProseSection from './sections/ProseSection.svelte';
import VideoSection from './sections/VideoSection.svelte';

export type SectionComponent = Component<SectionComponentProps>;

export const SECTION_COMPONENTS: Readonly<Record<string, SectionComponent>> = {
  hero: HeroSection,
  introVideo: VideoSection,
  reel: VideoSection,
  ache: ProseSection,
  turn: ProseSection,
  feel: ProseSection,
  map: MapSection,
  proof: ProofSection,
  guide: GuideSection,
  faq: FaqSection,
  invite: InviteSection,
};

/** The renderer component for a section type, or null for an unknown type. */
export function componentForType(type: string): SectionComponent | null {
  return SECTION_COMPONENTS[type] ?? null;
}
