// Brand Editor - Store
export { brandEditor } from './brand-editor-store.svelte';
export type { BrandPreviewSender } from './brand-preview-bridge';
// Brand Editor - Live preview bridge (Codex-cijzb · WP-1.4)
// Sender (studio) + applier (public org layout, embedded-only). The applier is
// imported by the PUBLIC org layout, so it MUST live under $lib/brand-editor
// (not $lib/components/brand-editor) to stay inside the WP-0.2 bundle boundary.
export {
  BRAND_PREVIEW_MESSAGE_TYPE,
  createBrandPreviewSender,
  initBrandPreviewBridge,
  reportPreviewResolved,
} from './brand-preview-bridge';
// Brand Editor - CSS Injection
export {
  clearTokenOverrides,
  // Codex-wwedk: per-theme dark tokenOverrides helpers (parallel to the
  // light versions). Used by the org layout SSR injection path.
  darkTokenOverridesToCssVars,
  injectDarkTokenOverrides,
  injectTokenOverrides,
  // Codex-403d3: what keeps an override inside its own declaration.
  isSafeDeclaration,
  tokenOverrideStyle,
  tokenOverridesToCssVars,
} from './css-injection';
// Brand Editor - Fallback defaults (used when an org has not branded)
export {
  BRAND_DEFAULT_ACCENT,
  BRAND_DEFAULT_BACKGROUND,
  BRAND_DEFAULT_PRIMARY,
  BRAND_DEFAULT_SECONDARY,
} from './defaults';
// Brand Editor - The org layout's write-back of its own inputs (Codex-q01h8)
export { writeBackLayoutBrandInputs } from './layout-brand-inputs.svelte';
export { answers, previewResolved } from './preview-resolved.svelte';

// Brand Editor - Palette Generator (internal use only; import directly from ./palette-generator)

// Brand Editor - Dark-mode override parser (SSR-safe, used by _org/[slug]/+layout.svelte)
export { parseDarkColorOverrides } from './parse-dark-overrides';

// Brand Editor - Preset axes (the composable vocabulary the guided mixer
// drives: type / form / atmosphere, plus the contrast helpers that keep a
// mixed combination legible). See preset-axes.ts for the defects this
// replaced.
export type {
  AtmosphereAxisId,
  FormAxisId,
  PresetPalette,
  TypeAxisId,
} from './preset-axes';
export {
  AA_TEXT_CONTRAST,
  ATMOSPHERE_AXES,
  composePreset,
  contrast,
  FORM_AXES,
  TYPE_AXES,
} from './preset-axes';
export type { PresetAxisPoint, PresetCategory } from './presets';
// Brand Editor - Presets
export { BRAND_PRESETS, PRESET_CATEGORY_ORDER } from './presets';
// Brand Editor - The landing's topic-selector style (Codex-8swlj.2). Pure, so
// the public landing bundle can read it.
export { resolveTopicsStyle } from './topics-style';
export type { BrandEditorState } from './types';
