/**
 * `$lib/page-builder/render` — the PUBLIC journey/course sales-page renderer
 * (Codex-2pryk · WP-3/WP-5).
 *
 * Section components + the type→component registry + the inline-edit primitive.
 * Imported by the public journey route AND the studio's WYSIWYG builder canvas.
 * Deliberately SEPARATE from the inert `$lib/page-builder` barrel (which must stay
 * component-free) — import renderer surfaces from here.
 */

/*
  THE DESIGN AXES, available to the canvas tree too.

  `ResolvedSectionDesign` is re-exported here so a canvas section can accept a
  `design` prop without importing across trees, and so both barrels name ONE type.
  The axis attributes themselves are emitted by `render/SectionRenderer.svelte`
  (contract A1 — the surviving seam is the PUBLIC tree); the canvas gains them when
  consolidation repoints `JourneyBuilderCanvas` at the unified components.

  CONVERGENCE NOTE for that consolidation: this barrel and `render/index.ts` both
  export a type named `SectionComponentProps`, and they DISAGREE — the canvas
  contract calls the config bag `props` and requires `variant`, the public one
  calls it `config` and makes `variant` optional. Reconciling those two names is
  the unification, and it is deliberately NOT done here: the 37 variant
  implementations still live in `render-edit/journey-sections.css`, and deleting
  this tree before each component WP has ported its own type's layouts would
  destroy the reference they port FROM (amendment A16).
*/
export type { ResolvedSectionDesign, SectionDesign } from '$lib/page-builder';
export { default as EditableText } from './EditableText.svelte';
export { type EditableTextParams, editableText } from './editable-text';
export { default as SectionRenderer } from './SectionRenderer.svelte';
export {
  componentForType,
  SECTION_COMPONENTS,
  type SectionComponent,
} from './section-registry';
export {
  has,
  type JourneyLessonPreview,
  type JourneyStagePreview,
  type SectionComponentProps,
  text,
} from './section-render';
