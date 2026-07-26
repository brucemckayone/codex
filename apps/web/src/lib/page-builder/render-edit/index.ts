/**
 * `$lib/page-builder/render` — the PUBLIC journey/course sales-page renderer
 * (Codex-2pryk · WP-3/WP-5).
 *
 * Section components + the type→component registry + the inline-edit primitive.
 * Imported by the public journey route AND the studio's WYSIWYG builder canvas.
 * Deliberately SEPARATE from the inert `$lib/page-builder` barrel (which must stay
 * component-free) — import renderer surfaces from here.
 */
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
