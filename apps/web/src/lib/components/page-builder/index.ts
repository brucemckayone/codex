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
// Design axes — the section-scope control (one axis, with its inheritance state).
export { default as DesignAxisControl } from './DesignAxisControl.svelte';
export {
  AXIS_HINTS,
  AXIS_LABELS,
  AXIS_VALUE_LABELS,
  axesForSectionType,
  axisOptions,
  DEFAULT_PRESET_ID,
  findDesignPreset,
  isAxisValue,
  MEDIA_AWARE_SECTION_TYPES,
  SECTION_DESIGN_PRESETS,
  type SectionDesignPreset,
} from './design-vocabulary';
// Canvas (INLINE WYSIWYG render of the section components + block toolbar).
export { default as JourneyBuilderCanvas } from './JourneyBuilderCanvas.svelte';
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
// Page-mode settings panels (Look / Pricing / Media / Brand / SEO).
export { default as PageBrandPanel } from './PageBrandPanel.svelte';
export { default as PageDesignPanel } from './PageDesignPanel.svelte';
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
  THE DESIGN-AXIS EDITOR UI — what F-B2 landed, against what F-B reserved.

  F-B reserved `DesignPanel.svelte` + `PresetPicker.svelte`. Two names, one of
  which does not exist: the preset picker IS the page-scope panel, so splitting it
  would have produced a wrapper whose only job was to render its only child. What
  landed instead:

    • `PageDesignPanel.svelte`   — page scope: the eight presets, the resolved
      summary of what a section inherits, and which sections opt out. Named for the
      `Page*Panel` family it joins (Brand / Media / Pricing / SEO), because it is
      mounted exactly as they are, by the builder's mode tabs.
    • `DesignAxisControl.svelte` — section scope: ONE axis, with its
      inherited-vs-overridden state and the way back. Nine of these are composed by
      `SectionEditor`'s Design group, which is where the per-section axes belong —
      beside the variant picker for the same section, not in a separate panel the
      creator has to hold in their head alongside it.

  The axis ENUMS are still not re-exported here: they live in `$lib/page-builder`
  (`SECTION_DESIGN_AXES` / `_VALUES` / `_DEFAULTS`), which this tree imports
  directly — the allowed direction. `design-vocabulary.ts` adds only LABELS and
  PRESETS, and its test asserts the label maps cover `SECTION_DESIGN_VALUES`
  exactly, so the second list cannot drift into offering a value the CSS has no
  rule for.
*/
