/**
 * Brand Studio — the `/studio/brand` two-pane workspace scaffolding.
 *
 * Reusable shell pieces for the unified brand editor (epic Codex-cijzb).
 * WP-1.1 ships the layout + placeholder rail/canvas; later WPs fill them.
 */

export { default as BrandStudioCanvas } from './BrandStudioCanvas.svelte';
export { default as BrandStudioLayout } from './BrandStudioLayout.svelte';
export { default as BrandStudioRail } from './BrandStudioRail.svelte';
export { default as CanvasToolbar } from './CanvasToolbar.svelte';
export { default as PreviewFrame } from './PreviewFrame.svelte';
export {
  PREVIEW_DEVICES,
  PREVIEW_ROUTES,
  type PreviewDevice,
  type PreviewDeviceId,
  type PreviewFrameLoad,
  type PreviewFrameTheme,
  type PreviewRoute,
  type PreviewRouteId,
  type PreviewThemeMode,
  resolvePreviewPath,
} from './preview-canvas';
