/**
 * `$lib/page-builder/render` — the public/inert journey SECTION RENDERER
 * (Codex-2pryk.3.1 · WP-3).
 *
 * The counterpart to WP-0's inert contract surface: given a persisted page's
 * `sections` + `brandOverrides` and the awaited course/stage/testimonial data,
 * it renders the public sales page. It consumes ONLY DS primitives + the brand
 * editor's pure token serialisers — never the studio editor UI — so it stays
 * inside the CE-4 PUBLIC_LIB_ROOT boundary and is safe to load in the public
 * bundle and in WP-5's same-origin preview iframe.
 */

export {
  brandOverrideLogo,
  brandOverridesToCssVars,
  brandOverridesToStyleAttr,
} from './brand-overrides';
export { default as CtaLink } from './CtaLink.svelte';
export { default as JourneyRenderer } from './JourneyRenderer.svelte';
export { default as SectionRenderer } from './SectionRenderer.svelte';

export {
  type RenderableSection,
  resolveSectionComponent,
  SECTION_COMPONENTS,
  type SectionComponent,
  type SectionComponentProps,
  selectRenderableSections,
} from './section-registry';

export type {
  AcheSectionProps,
  FaqEntry,
  FaqSectionProps,
  FeelInclusion,
  FeelSectionProps,
  GuideSectionProps,
  HeroSectionProps,
  IntroVideoSectionProps,
  InviteOffer,
  InviteSectionProps,
  JourneySalesContext,
  MapSectionProps,
  PreviewMedia,
  ProofSectionProps,
  ReelSectionProps,
  SellPreview,
  TurnSectionProps,
} from './types';
