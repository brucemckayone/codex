/**
 * Page-builder EDITOR UI — the heavy studio-only journey/page builder
 * (Codex-2pryk.3.3 · WP-5).
 *
 * IMPORT BOUNDARY (CE-4 gate): this tree is admin-only editor UI. It must NEVER
 * be statically imported by public-bundle code — only `studio/journeys/*` routes
 * (the `ssr = false` studio SPA chunk) may import it. Public journey pages import
 * only the inert `$lib/page-builder`. The `check:brand-boundary` gate enforces
 * this. Conversely, this tree freely imports the public-safe `$lib/page-builder`
 * (store, bridge, section catalogue) — the allowed direction.
 */

export { default as AddSectionPicker } from './AddSectionPicker.svelte';
// Canvas (stable same-origin iframe of the real journey page + preview bridge seam).
export { default as JourneyBuilderCanvas } from './JourneyBuilderCanvas.svelte';
// Rail (section list + add-picker + per-section config editor).
export { default as JourneyBuilderRail } from './JourneyBuilderRail.svelte';
export { default as JourneyCanvasToolbar } from './JourneyCanvasToolbar.svelte';
export { default as JourneyPreviewFrame } from './JourneyPreviewFrame.svelte';
export {
  JOURNEY_PREVIEW_DEVICES,
  type JourneyPreviewDevice,
  type JourneyPreviewDeviceId,
  type JourneyPreviewFrameLoad,
  type JourneyPreviewFrameTheme,
  type JourneyPreviewThemeMode,
  resolveJourneyPreviewPath,
} from './journey-preview-canvas';
export {
  createJourneyPreviewWiring,
  type JourneyPreviewWiring,
} from './preview-wiring';
export { default as SectionEditor } from './SectionEditor.svelte';
export { default as SectionList } from './SectionList.svelte';
export {
  fieldsForSectionType,
  SECTION_FIELDS,
  type SectionFieldControl,
  type SectionFieldDef,
} from './section-fields';
