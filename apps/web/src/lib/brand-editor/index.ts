// Brand Editor - Store
export { brandEditor } from './brand-editor-store.svelte';
export type {
  BrandPreviewMessage,
  BrandPreviewSender,
} from './brand-preview-bridge';
// Brand Editor - Live preview bridge (Codex-cijzb · WP-1.4)
// Sender (studio) + applier (public org layout, embedded-only). The applier is
// imported by the PUBLIC org layout, so it MUST live under $lib/brand-editor
// (not $lib/components/brand-editor) to stay inside the WP-0.2 bundle boundary.
export {
  BRAND_PREVIEW_MESSAGE_TYPE,
  createBrandPreviewSender,
  initBrandPreviewBridge,
} from './brand-preview-bridge';
// Brand Editor - CSS Injection
export {
  clearTokenOverrides,
  // Codex-wwedk: per-theme dark tokenOverrides helpers (parallel to the
  // light versions). Used by the org layout SSR injection path.
  darkTokenOverridesToCssVars,
  injectDarkTokenOverrides,
  injectTokenOverrides,
  tokenOverridesToCssVars,
} from './css-injection';
// Brand Editor - Fallback defaults (used when an org has not branded)
export {
  BRAND_DEFAULT_ACCENT,
  BRAND_DEFAULT_BACKGROUND,
  BRAND_DEFAULT_PRIMARY,
  BRAND_DEFAULT_SECONDARY,
} from './defaults';
// Brand Editor - Navigation
export { LEVELS } from './levels';

// Brand Editor - Palette Generator (internal use only; import directly from ./palette-generator)

// Brand Editor - Dark-mode override parser (SSR-safe, used by _org/[slug]/+layout.svelte)
export { parseDarkColorOverrides } from './parse-dark-overrides';

export type { PresetCategory } from './presets';
// Brand Editor - Presets
export { BRAND_PRESETS } from './presets';
export type {
  BrandEditorState,
  LevelId,
} from './types';
