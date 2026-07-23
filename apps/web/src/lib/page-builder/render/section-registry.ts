/**
 * Section-type → Svelte component registry (Codex-2pryk.3.1 · WP-3).
 *
 * The public renderer maps a KNOWN {@link CourseSectionType} to its component
 * and SKIPS any unknown type — the frozen contract widens `PageSection.type` to
 * `string` precisely so a future/unrecognised section type degrades to "not
 * rendered" instead of a decode error (forward-compatible). This registry is the
 * one place that mapping lives.
 *
 * INERT + CE-4-safe: it imports section components that themselves consume only
 * DS primitives + the brand-editor token layer — never the studio editor UI
 * (`$lib/components/page-builder`).
 */
import type { Component } from 'svelte';
import type {
  CourseSectionType,
  PageSection,
  SectionProps,
} from '$lib/page-builder';
import AcheSection from './sections/AcheSection.svelte';
import FaqSection from './sections/FaqSection.svelte';
import FeelSection from './sections/FeelSection.svelte';
import GuideSection from './sections/GuideSection.svelte';
import HeroSection from './sections/HeroSection.svelte';
import IntroVideoSection from './sections/IntroVideoSection.svelte';
import InviteSection from './sections/InviteSection.svelte';
import MapSection from './sections/MapSection.svelte';
import ProofSection from './sections/ProofSection.svelte';
import ReelSection from './sections/ReelSection.svelte';
import TurnSection from './sections/TurnSection.svelte';
import type { JourneySalesContext } from './types';

/** The uniform prop contract every section component renders against. */
export interface SectionComponentProps {
  config: SectionProps;
  context: JourneySalesContext;
}

/** A renderable section component. */
export type SectionComponent = Component<SectionComponentProps>;

/**
 * The catalogue's section types mapped to their components (in ship order, for
 * readability — order at render time comes from the page's `sections` array).
 */
export const SECTION_COMPONENTS: Record<CourseSectionType, SectionComponent> = {
  hero: HeroSection,
  introVideo: IntroVideoSection,
  ache: AcheSection,
  turn: TurnSection,
  reel: ReelSection,
  map: MapSection,
  feel: FeelSection,
  proof: ProofSection,
  guide: GuideSection,
  faq: FaqSection,
  invite: InviteSection,
};

/**
 * Resolve a stored section type (a widenable `string`) to its component, or
 * `null` when the type is not in this template's catalogue — the renderer skips
 * a `null` (forward-compatible with future section types / other page types).
 */
export function resolveSectionComponent(type: string): SectionComponent | null {
  return (
    (SECTION_COMPONENTS as Record<string, SectionComponent | undefined>)[
      type
    ] ?? null
  );
}

/** A section paired with its resolved component, ready to render. */
export interface RenderableSection {
  section: PageSection;
  Component: SectionComponent;
}

/**
 * The pure heart of the renderer: given a page's ordered `sections`, return the
 * ones that should render — ENABLED and of a KNOWN type — each paired with its
 * component, in stored order. Disabled sections and unknown types are dropped
 * (forward-compatible). Extracted so the selection rules are unit-testable
 * without a DOM.
 */
export function selectRenderableSections(
  sections: readonly PageSection[]
): RenderableSection[] {
  const out: RenderableSection[] = [];
  for (const section of sections) {
    if (!section.enabled) continue;
    const Component = resolveSectionComponent(section.type);
    if (Component === null) continue;
    out.push({ section, Component });
  }
  return out;
}
