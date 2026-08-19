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
// Canvas (INLINE WYSIWYG render of the section components + block toolbar).
export { default as JourneyBuilderCanvas } from './JourneyBuilderCanvas.svelte';
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
// Page-mode settings panels (Pricing / Media / Brand / SEO).
export { default as PageBrandPanel } from './PageBrandPanel.svelte';
export { default as PageMediaPanel } from './PageMediaPanel.svelte';
export { default as PagePricingPanel } from './PagePricingPanel.svelte';
export { default as PageSeoPanel } from './PageSeoPanel.svelte';
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
  type SectionFieldOption,
} from './section-fields';
export { default as VariantPicker } from './VariantPicker.svelte';
/*
  RESERVED SLOTS — the design-axis editor UI (journey-sections F-B).

  The axis vocabulary itself is NOT re-exported here: it lives in
  `$lib/page-builder` (`SECTION_DESIGN_AXES` / `SECTION_DESIGN_VALUES` /
  `SECTION_DESIGN_DEFAULTS`), which this tree may import directly — the allowed
  direction. A second copy in the editor barrel is how an axis value ends up
  selectable in the panel and unstyled on the page.

  F-B adds, alphabetically among the exports above:
    • `DesignPanel.svelte`  — the nine axis controls (page scope + section scope)
    • `PresetPicker.svelte` — the eight composition presets from research §4

  Named here so both land in a known place rather than at whichever line each
  worktree happens to pick.
*/
