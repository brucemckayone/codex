/**
 * `$lib/page-builder/kit` — the page kit's public surface
 * (docs/design/landing-builder/01-contract.md §6).
 *
 * Public-bundle code: nothing here may import the studio editor
 * (`$lib/components/page-builder`, `check-brand-editor-boundary.mjs`).
 */
export { DEFINITIONS, fieldOf, GROUP_ORDER } from './model/catalog';
export { COPY } from './model/copy';
export {
  isEnrolled,
  type PrimaryCta,
  type PrimaryCtaState,
  pathHref,
  resolvePrimaryCta,
} from './model/cta';
export * from './model/ids';
export {
  type PricingState,
  type PricingView,
  pricingView,
} from './model/offer';
export {
  featuredScheme,
  renderableSections,
  resolveLayout,
  resolveScheme,
  resolveSections,
  resolveSpacing,
  resolveStyle,
} from './model/resolve';
export {
  SAMPLE_COURSE,
  SAMPLE_OFFER_STATES,
  type SampleOfferState,
  sampleContext,
  sampleOffer,
  samplePage,
} from './model/sample';
export {
  type ShapeIssue,
  type ShapeIssueCode,
  validateKitShape,
} from './model/shape';
export {
  SCHEME_OPTIONS,
  SPACING_OPTIONS,
  STYLES,
  type StyleDefinition,
} from './model/styles';
export { starterPage, starterSection } from './model/template';
export type * from './model/types';
export { default as PageRenderer } from './PageRenderer.svelte';
export type { PageEdit } from './page-context';
export {
  BLOCKS,
  blockFor,
  type KitBlock,
  type KitBlockComponent,
} from './registry';
export { default as SectionShell } from './SectionShell.svelte';
export { default as StickyCta } from './StickyCta.svelte';
