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
  ResolvedSectionDesign,
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

/**
 * The uniform prop contract every section component renders against.
 *
 * The four additive props below are ALL OPTIONAL, deliberately: this interface is
 * the single props contract for all 11 sections, so making any of them required
 * would break every component in one commit and force the whole programme through
 * one worktree. Optional means the foundation lands the seam, and each component
 * work-package opts in when it implements its axes and its edit affordances.
 */
export interface SectionComponentProps {
  config: SectionProps;
  context: JourneySalesContext;
  /**
   * The COMPOSITION to draw — `resolveVariant(section)`'s output (a catalogue
   * variant id, or `''` for an unknown type). Until Codex-qcgo3 this was not
   * merely un-passed, it was absent from this type, so all 37 declared variants
   * were unreachable on the public page. A component that has not implemented its
   * variants yet simply ignores it.
   */
  variant?: string;
  /**
   * The FULLY RESOLVED design axes — `resolveDesign(section, page)`'s output.
   * `SectionRenderer` also emits these as `data-jp-*` attributes on the section
   * wrapper, which is how CSS reads them; the prop exists for the cases that need
   * an axis in MARKUP or in JS (e.g. `motion: 'none'` skipping a reveal
   * observer, or `media: 'none'` not rendering a frame at all).
   */
  design?: ResolvedSectionDesign;
  /**
   * Whether this render is the studio's inline WYSIWYG canvas rather than the
   * public page — the seam that lets ONE component set serve both trees.
   *
   * Passed as a PROP, never resolved by an import: `$lib/page-builder` is the
   * CE-4-scanned PUBLIC_LIB_ROOT and must never pull in
   * `$lib/components/page-builder`. Defaults to false ⇒ public, read-only.
   */
  editable?: boolean;
  /**
   * Commit an inline copy edit: `key` is the `props` key the field maps to,
   * `value` the new string. Only meaningful when `editable` is true; the public
   * renderer never passes it.
   */
  onEdit?: (key: string, value: string) => void;
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
  /**
   * The section's DOM id — its in-page anchor target, guaranteed unique within
   * the page. See {@link selectRenderableSections} for the scheme.
   */
  anchorId: string;
}

/**
 * The next free anchor id for a section type: the bare type when unused, else the
 * type plus the lowest free ordinal (`ache`, `ache-2`, `ache-3`, …).
 *
 * The ordinal is searched rather than assumed so a generated id can never collide
 * with a real section type — a page holding types `ache`, `ache` and (some future)
 * `ache-2` still produces three distinct ids.
 */
function claimAnchorId(type: string, used: Set<string>): string {
  if (!used.has(type)) {
    used.add(type);
    return type;
  }
  let n = 2;
  while (used.has(`${type}-${n}`)) n += 1;
  const id = `${type}-${n}`;
  used.add(id);
  return id;
}

/**
 * The pure heart of the renderer: given a page's ordered `sections`, return the
 * ones that should render — ENABLED and of a KNOWN type — each paired with its
 * component and its DOM id, in stored order. Disabled sections and unknown types
 * are dropped (forward-compatible). Extracted so the selection rules — and the
 * id scheme — are unit-testable without a DOM.
 *
 * ANCHOR IDS (Codex-yxkj7). The renderer used the section TYPE as the DOM id,
 * justified by a comment claiming types are unique within a page. They are not:
 * `duplicateSection()` clones a section with the SAME type, and the seeded golden
 * page (`of-blood-and-bones` → `pricing-smoke-test`) served two
 * `<section id="ache">` — an invalid document where `#ache` resolves to whichever
 * came first.
 *
 * The FIRST section of a type keeps the type-named id, so any `#<type>` link a
 * visitor already holds still lands on the section they expect; later duplicates
 * take an ordinal suffix. (No component currently EMITS an in-page anchor — the
 * hero's scroll cue is a decorative `aria-hidden` div, not the `#map` link the
 * old comment here claimed — but the ids are in served HTML and therefore
 * bookmarkable, so the first-wins rule is what keeps them stable.)
 *
 * Assigned HERE, over the already-filtered list, so a disabled or unknown section
 * never consumes an ordinal and toggling one off cannot renumber its neighbours.
 */
export function selectRenderableSections(
  sections: readonly PageSection[]
): RenderableSection[] {
  const used = new Set<string>();
  const out: RenderableSection[] = [];
  for (const section of sections) {
    if (!section.enabled) continue;
    const Component = resolveSectionComponent(section.type);
    if (Component === null) continue;
    out.push({
      section,
      Component,
      anchorId: claimAnchorId(section.type, used),
    });
  }
  return out;
}
