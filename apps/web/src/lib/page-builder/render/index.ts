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
// The prop-coercion layer + the BUILDER→RENDERER key map (Codex-tqr51), trimmed
// (WP-9a) to the names still read outside this module: `asString` by checkout,
// `asObjectArray`/`fieldBool`/`fieldString` by `offer-paths.ts`, `asNumberedGroups`
// by `kit/model/legacy/read-helpers.ts`, and `SECTION_PROP_ALIASES` by both
// `kit/model/legacy/prop-mappers.ts` and `./editable`.
export {
  asNumberedGroups,
  asObjectArray,
  asString,
  fieldBool,
  fieldString,
  SECTION_PROP_ALIASES,
} from './coerce';
/**
 * THE STUDIO CANVAS'S INLINE-EDIT SEAM (F38).
 *
 * `editFieldLabel` / `editFieldName` are exported so an accessible name can
 * restate a field's own label without this module importing the editor's field
 * definitions — that is the banned direction under the CE-4 boundary. The EDITOR
 * side may import this tree (never the reverse).
 *
 * The legacy nine-axis editor's round-trip guard (`section-fields.test.ts`,
 * pinning this against `SECTION_FIELDS`) was deleted with the rest of that
 * editor (WP-9a); the v2 editor's field vocabulary lives in `kit/model/fields.ts`
 * and has not yet grown an equivalent pin.
 */
export {
  type EditFieldCommit,
  editFieldAttrs,
  editFieldLabel,
  editFieldName,
} from './editable';
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
