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

// Re-exported through the renderer barrel too, so a section component reaches its
// own props' types (`design`) without a second import path.
export type { ResolvedSectionDesign, SectionDesign } from '$lib/page-builder';
export {
  brandOverrideLogo,
  brandOverridesToCssVars,
  brandOverridesToStyleAttr,
} from './brand-overrides';
export {
  type BuilderContextInput,
  builderSalesContext,
} from './builder-context';
export { default as CtaLink } from './CtaLink.svelte';
// The prop-coercion layer + the BUILDER→RENDERER key map (Codex-tqr51). Exported
// so the round-trip guard in `components/page-builder/section-fields.test.ts` can
// assert every writable key is read — the allowed import direction (editor UI may
// import the public tree, never the reverse).
export {
  aliasKeys,
  asBool,
  asNumberedGroups,
  asObjectArray,
  asParagraphsFrom,
  asString,
  asStringArray,
  asStringFrom,
  asStringsFrom,
  fieldBool,
  fieldString,
  SECTION_PROP_ALIASES,
} from './coerce';
/**
 * THE STUDIO CANVAS'S INLINE-EDIT SEAM, built once for all eleven sections (F38).
 *
 * `editFieldLabel` / `editFieldName` are exported for a round-trip guard: the
 * accessible names restate the editor's own field labels, and this module cannot
 * import `components/page-builder/section-fields.ts` to derive them — that is the
 * banned direction under the CE-4 boundary. The EDITOR side may import this tree,
 * so a test in `components/page-builder/section-fields.test.ts` can pin the two
 * vocabularies together. See the handoff.
 */
export {
  type EditFieldCommit,
  editFieldAttrs,
  editFieldLabel,
  editFieldName,
} from './editable';
export { default as JourneyRenderer } from './JourneyRenderer.svelte';
/**
 * ONE section's wrapper + component invocation. Exported for the studio canvas,
 * which owns its own section loop (it interleaves per-block editing chrome) and
 * so needs the per-section half of the render seam without the array-level half
 * (Codex-eckbx W1-W3).
 */
export { default as SectionFrame } from './SectionFrame.svelte';
export { default as SectionRenderer } from './SectionRenderer.svelte';
export {
  /**
   * WHICH section may borrow the course title. Exported for the studio canvas,
   * which owns its own section loop and must therefore resolve the claim the way
   * `SectionRenderer` does and pass the result to each `SectionFrame` — otherwise
   * its sections self-hide a heading the published page shows. It does not do that
   * yet; see the handoff.
   */
  claimTitleFallback,
  type PageShapeIssue,
  type RenderableSection,
  resolveSectionComponent,
  SECTION_COMPONENTS,
  type SectionComponent,
  type SectionComponentProps,
  selectRenderableSections,
  /**
   * A page's SECTION COMPOSITION, validated. Exported for the studio's publish
   * action, which blocks on the `error` severities — it currently reaches this
   * function by importing `render/section-registry` directly, because the export
   * was not here when it was written, and should be pointed at this barrel. Read
   * {@link PageShapeIssue.severity} first: it records which halves of the
   * enforcement are wired and which are not.
   */
  validatePageShape,
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
